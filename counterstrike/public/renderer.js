import * as THREE from '/vendor/three.module.min.js';
import { WALLS, SITES, COLORS, RULES, TICK_HZ, movePlayer } from '/game.js';

const SCALE = 40;
export class FirstPersonView {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({canvas, antialias:true, powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#a2b5c0');
    this.scene.fog = new THREE.Fog('#a2b5c0', 25, 65);
    this.camera = new THREE.PerspectiveCamera(80, 16/9, 0.025, 100);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.scene.add(new THREE.HemisphereLight('#e2efff', '#796c52', 2.5));
    const sun = new THREE.DirectionalLight('#ffe1b1', 3.1);
    sun.position.set(7,20,-8); sun.castShadow = true;
    sun.shadow.mapSize.set(1024,1024);
    Object.assign(sun.shadow.camera,{left:-25,right:25,top:25,bottom:-25,near:0.1,far:70});
    sun.shadow.normalBias=0.03; this.scene.add(sun);
    sun.target.position.set(15,0,9); this.scene.add(sun.target);
    this.materials = new Map(); this.avatars = []; this.tracers = []; this.weaponId = -1;
    this.boxGeometry = new THREE.BoxGeometry(1,1,1);
    this.staticBoxes = new Map(); this.buildingMap = true;
    this.cameraPoint = new THREE.Vector3(); this.predicted = { x:0, y:0 };
    this.latest = null; this.mine = -1; this.lastTime = 0; this.recoil = 0; this.hitUntil = 0;
    this.buildMap();
    this.batchMap(); this.buildingMap = false;
    this.gun = new THREE.Group(); this.camera.add(this.gun);
    this.bomb = new THREE.Group(); this.scene.add(this.bomb);
    this.box(this.bomb,0,0.13,0,0.36,0.22,0.25,'#354239');
    this.bombLight=this.box(this.bomb,0,0.25,0,0.1,0.02,0.1,'#ef7a43');
    this.observer = new ResizeObserver(()=>this.resize()); this.observer.observe(canvas.parentElement);
  }
  material(color) {
    if (!this.materials.has(color)) this.materials.set(color,new THREE.MeshStandardMaterial({color,roughness:0.87}));
    return this.materials.get(color);
  }
  box(parent,x,y,z,w,h,d,color) {
    if(this.buildingMap) {
      if(!this.staticBoxes.has(color)) this.staticBoxes.set(color,[]);
      this.staticBoxes.get(color).push([x,y,z,w,h,d]); return;
    }
    const mesh=new THREE.Mesh(this.boxGeometry,this.material(color));
    mesh.position.set(x,y,z); mesh.scale.set(w,h,d);
    mesh.receiveShadow=true; parent.add(mesh); return mesh;
  }
  batchMap() {
    const transform=new THREE.Object3D();
    for(const [color,boxes] of this.staticBoxes) {
      const mesh=new THREE.InstancedMesh(this.boxGeometry,this.material(color),boxes.length);
      boxes.forEach(([x,y,z,w,h,d],i)=>{
        transform.position.set(x,y,z); transform.scale.set(w,h,d); transform.updateMatrix();
        mesh.setMatrixAt(i,transform.matrix);
      });
      mesh.castShadow=true; mesh.receiveShadow=true; mesh.matrixAutoUpdate=false;
      this.scene.add(mesh);
    }
    this.staticBoxes.clear();
  }
  label(text,color='#e8c16c',background='#303c40') {
    const canvas=document.createElement('canvas'); canvas.width=512; canvas.height=256;
    const context=canvas.getContext('2d'); context.fillStyle=background; context.fillRect(0,0,512,256);
    context.strokeStyle=color; context.lineWidth=10; context.strokeRect(15,15,482,226);
    context.fillStyle=color; context.textAlign='center'; context.textBaseline='middle'; context.font='bold 105px monospace'; context.fillText(text,256,132);
    const texture=new THREE.CanvasTexture(canvas); texture.colorSpace=THREE.SRGBColorSpace;
    return new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide});
  }
  buildMap() {
    this.box(this.scene,15,-0.15,9.5,32,0.3,21,'#9c9078');
    const grid = new THREE.GridHelper(32,32,'#897e6b','#928570'); grid.position.set(15,0.006,9.5); this.scene.add(grid);
    for(const [i,[x,y,w,h]] of WALLS.entries()) {
      const cx=(x+w/2)/SCALE, cz=(y+h/2)/SCALE, height=RULES.wallHeight/SCALE;
      this.box(this.scene,cx,height/2,cz,w/SCALE,height,h/SCALE,i<4?'#bdad91':'#c7b99c');
      this.box(this.scene,cx,height+0.05,cz,w/SCALE+0.1,0.1,h/SCALE+0.1,'#e3d6b8');
      this.box(this.scene,cx,0.16,cz,w/SCALE+0.035,0.32,h/SCALE+0.035,'#877e6c');
      if(i>=4) {
        for(let layer=1;layer<=3;layer++) this.box(this.scene,cx,layer*0.82,cz,w/SCALE+0.015,0.018,h/SCALE+0.015,'#afa087');
        const sign=new THREE.Mesh(new THREE.PlaneGeometry(1.0,0.52),this.label(i%2?'B →':'← A'));
        sign.position.set((x-0.5)/SCALE,1.8,cz); sign.rotation.y=-Math.PI/2; this.scene.add(sign);
      }
    }
    for(const [i,[x,y,r]] of SITES.entries()) {
      const mark=new THREE.Mesh(new THREE.PlaneGeometry(r*2/SCALE,r*2/SCALE),this.label(i?'B':'A','#f8c769','#8f7955'));
      mark.rotation.x=-Math.PI/2; mark.position.set(x/SCALE,0.015,y/SCALE); this.scene.add(mark);
    }
    for(const [x,z,team] of [[2.3,9.5,0],[28,9.5,1]]) {
      const spawn=new THREE.Mesh(new THREE.PlaneGeometry(2.5,6.5),new THREE.MeshBasicMaterial({color:COLORS[team],transparent:true,opacity:0.12,depthWrite:false}));
      spawn.rotation.x=-Math.PI/2; spawn.position.set(x,0.02,z); this.scene.add(spawn);
    }
    // Distant buildings stay outside the playable collision boundary.
    for(let i=0;i<12;i++) {
      const h=5+(i%4)*1.4, x=i*3.8-6;
      this.box(this.scene,x,h/2,-4,3,h,4,i%2?'#998e7d':'#afa592');
      for(let row=1;row<h-0.5;row+=1.5) for(const offset of [-0.75,0.75]) this.box(this.scene,x+offset,row,-1.985,0.5,0.7,0.02,'#455357');
    }
  }
  setup(players,mine) {
    for(const avatar of this.avatars) this.scene.remove(avatar);
    this.avatars=players.map((_,i)=>{
      const group=new THREE.Group(), color=COLORS[i%2];
      this.box(group,-0.14,0.4,0,0.2,0.8,0.25,'#303b38');
      this.box(group,0.14,0.4,0,0.2,0.8,0.25,'#303b38');
      this.box(group,0,1.05,0,0.53,0.62,0.4,color);
      this.box(group,0,1.1,-0.215,0.4,0.43,0.08,'#34423d');
      this.box(group,-0.31,1.07,-0.03,0.16,0.49,0.22,color);
      this.box(group,0.31,1.07,-0.1,0.16,0.49,0.22,color);
      this.box(group,0,1.59,0,0.34,0.42,0.34,'#b7a184');
      this.box(group,0,1.78,0,0.4,0.18,0.4,'#3b4740');
      this.box(group,0,1.63,-0.18,0.3,0.1,0.04,'#17272d');
      this.box(group,0.22,1.19,-0.4,0.12,0.14,0.72,'#26332e');
      this.scene.add(group); return group;
    });
    this.mine=mine; this.latest=null; this.previous=null; this.cameraReady=false; this.clearEffects();
  }
  clearEffects() {
    for(const t of this.tracers) { this.scene.remove(t.line); t.line.geometry.dispose(); t.line.material.dispose(); }
    this.tracers=[]; this.recoil=0; this.latest=null; this.previous=null; this.cameraReady=false;
  }
  makeGun(id) {
    if(this.flash) this.flash.material.dispose();
    this.gun.clear();
    const rifle=id>0, sniper=id===3;
    this.box(this.gun,0,-0.02,0,rifle?0.13:0.11,0.15,rifle?0.5:0.23,'#283533');
    this.box(this.gun,0,0.06,-0.03,0.1,0.04,rifle?0.46:0.25,'#59645b');
    this.box(this.gun,0,-0.13,0.05,0.08,0.2,0.12,'#504a39');
    if(rifle) this.box(this.gun,0,-0.15,-0.1,0.075,0.2,0.12,'#39423e');
    this.box(this.gun,0,0,-(rifle?0.41:0.17),0.046,0.046,sniper?0.62:rifle?0.34:0.11,'#1e2727');
    if(sniper) this.box(this.gun,0,0.155,-0.07,0.11,0.11,0.29,'#1a2829');
    this.box(this.gun,0.045,-0.23,0.22,0.12,0.12,0.4,'#53604f');
    this.box(this.gun,0.02,-0.13,0.07,0.13,0.12,0.15,'#292f2b');
    this.flash=this.box(this.gun,0,0,-(sniper?0.75:rifle?0.6:0.24),0.16,0.16,0.15,'#ffde83');
    this.flash.material=new THREE.MeshBasicMaterial({color:'#ffe6a0'}); this.flash.visible=false;
    this.weaponId=id;
  }
  update(snapshot) {
    const previous=this.latest;
    this.previous=previous; this.latest=snapshot; this.receivedAt=performance.now();
    if(!previous || previous.k!==snapshot.k) for(const [who,x1,y1,x2,y2,hit,z2] of snapshot.e) {
      const points=[new THREE.Vector3(x1/SCALE,RULES.eye/SCALE,y1/SCALE),new THREE.Vector3(x2/SCALE,z2/SCALE,y2/SCALE)];
      const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:COLORS[who%2],transparent:true,opacity:0.8}));
      this.scene.add(line); this.tracers.push({line,until:performance.now()+85});
      if(who===this.mine) { this.recoil=1; this.shotUntil=performance.now()+70; if(hit>=0 && hit%2!==this.mine%2) this.hitUntil=performance.now()+140; }
    }
  }
  resize() {
    const width=this.canvas.clientWidth, height=this.canvas.clientHeight;
    if(!width || !height) return;
    if(width===this.width && height===this.height) return;
    this.width=width; this.height=height;
    this.renderer.setSize(width,height,false); this.camera.aspect=width/height; this.camera.updateProjectionMatrix();
  }
  render(now,look,ads=false) {
    const s=this.latest; if(!s) return;
    const dt=Math.min(0.1,(now-this.lastTime)/1000 || 0.033); this.lastTime=now;
    let target=this.mine;
    if(target<0 || s.p[target][3]<=0) target=s.p.findIndex((p,i)=>p[3]>0 && (this.mine<0 || i%2===this.mine%2));
    if(target<0) target=s.p.findIndex(p=>p[3]>0);
    if(target<0) target=0;
    const local=target===this.mine && s.p[target][3]>0, p=s.p[target];
    this.predicted.x=p[0]; this.predicted.y=p[1];
    const age=Math.max(0,now-this.receivedAt), extrapolation=Math.min(1,age*TICK_HZ/1000);
    if(local && !s.freeze && !s.over) movePlayer(this.predicted,look[0],look[1],p[8],extrapolation);
    const point=this.cameraPoint.set(this.predicted.x/SCALE,RULES.eye/SCALE,this.predicted.y/SCALE);
    if(local || !this.cameraReady || this.lastTarget!==target) this.camera.position.copy(point);
    else this.camera.position.lerp(point,1-Math.exp(-22*dt));
    this.cameraReady=true; this.lastTarget=target;
    this.camera.rotation.set((local?look[2]:p[12])*Math.PI/180,-(local?look[1]:p[2])*Math.PI/180-Math.PI/2,0,'YXZ');
    this.avatars.forEach((avatar,i)=>{
      const q=s.p[i]; avatar.visible=i!==target && q[3]>0;
      const before=this.previous?.p[i];
      const blend=Math.min(1,age*TICK_HZ/1000);
      const smooth=before && Math.hypot(q[0]-before[0],q[1]-before[1])<30 && !s.over;
      const x=smooth?before[0]+(q[0]-before[0])*blend:q[0], y=smooth?before[1]+(q[1]-before[1])*blend:q[1];
      avatar.position.set(x/SCALE,0,y/SCALE); avatar.rotation.y=-q[2]*Math.PI/180-Math.PI/2;
    });
    const weapon=p[8]; if(weapon!==this.weaponId) this.makeGun(weapon);
    const zoom=ads && local; const fov=zoom?(weapon===3?27:55):80;
    if(this.camera.fov!==fov) { this.camera.fov=fov; this.camera.updateProjectionMatrix(); }
    this.gun.visible=local && p[3]>0;
    const bob=(look[0]&15)&&!s.freeze?Math.sin(now*0.012)*0.009:0;
    this.recoil=Math.max(0,this.recoil-dt*7);
    this.gun.position.set(zoom?0:0.24,-0.24+bob-(p[5]?0.16:0),-0.43+this.recoil*0.075);
    this.gun.rotation.set(this.recoil*0.07,p[5]?-0.3:0,p[5]?-0.35:0);
    this.flash.visible=now<(this.shotUntil||0);
    this.bomb.visible=s.b[0]===1 || s.b[0]===0 && s.b[1]<0;
    this.bomb.position.set(s.b[2]/SCALE,0,s.b[3]/SCALE);
    this.bombLight.visible=s.b[0]!==1 || s.k%15<8;
    this.tracers=this.tracers.filter(t=>{
      if(now<t.until) return true;
      this.scene.remove(t.line); t.line.geometry.dispose(); t.line.material.dispose(); return false;
    });
    this.renderer.render(this.scene,this.camera);
  }
}
