import * as THREE from "/vendor/three.module.min.js";

export class ArenaView {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-10, 10, 8, -8, 0.1, 100);
    this.camera.position.set(0, 13, 18);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(new THREE.HemisphereLight(0xe9ffcb, 0x253020, 2.5));
    const sun = new THREE.DirectionalLight(0xfff3d0, 3.4);
    sun.position.set(-6, 13, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(512, 512);
    Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 40 });
    sun.shadow.bias = -0.001;
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun);
    const rimLight = new THREE.DirectionalLight(0xb0ff89, 1.5);
    rimLight.position.set(5, 5, -8);
    this.scene.add(rimLight);
    this.world = new THREE.Group();
    this.scene.add(this.world);
    this.fighters = [];
    this.baseRadius = 5.8;
    this.preview = true;
    this.latest = null;
    this.setup({ radius: 5.8 }, [
      { color: "#b3ff70", name: "YOU" }, { color: "#ad94ff", name: "RIVAL" }
    ], null);
    this.preview = true;
    this.resize = () => { this.layout(); this.render(); };
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(canvas.parentElement);
    this.render();
  }

  material(color, extra = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.68, ...extra });
  }

  mesh(geometry, material, parent, x = 0, y = 0, z = 0) {
    const object = new THREE.Mesh(geometry, material);
    object.position.set(x, y, z);
    object.castShadow = true;
    object.receiveShadow = true;
    parent.add(object);
    return object;
  }

  setup(map, players, myId) {
    const materials = new Set(), geometries = new Set(), textures = new Set();
    this.world.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) {
        materials.add(object.material);
        if (object.material.map) textures.add(object.material.map);
      }
    });
    geometries.forEach(g => g.dispose());
    materials.forEach(m => m.dispose());
    textures.forEach(t => t.dispose());
    this.world.clear();
    this.preview = myId == null;
    this.latest = null;
    this.baseRadius = map.radius;
    this.platform = new THREE.Group();
    this.world.add(this.platform);
    const r = this.baseRadius;
    this.mesh(new THREE.CylinderGeometry(r, r * 0.93, 0.7, 64), this.material(0x414b36), this.platform, 0, -0.4);
    this.mesh(new THREE.CylinderGeometry(r * 0.93, r * 0.74, 0.65, 12), this.material(0x293025), this.platform, 0, -1.07);
    this.mesh(new THREE.CylinderGeometry(r - 0.08, r - 0.08, 0.1, 64), this.material(0x73815c), this.platform, 0, -0.04);
    const edge = this.mesh(new THREE.TorusGeometry(r - 0.05, 0.065, 8, 80), this.material(0xb7ef79, { emissive: 0x507726, emissiveIntensity: 0.5 }), this.platform, 0, 0.025);
    edge.rotation.x = Math.PI / 2;
    const circle = this.mesh(new THREE.RingGeometry(1.2, 1.24, 64), this.material(0xa4b68a), this.platform, 0, 0.022);
    circle.rotation.x = -Math.PI / 2;
    const lineMaterial = this.material(0x8d9f73);
    for (let i = 0; i < 32; i++) {
      const a = i / 32 * Math.PI * 2;
      const marker = this.mesh(new THREE.BoxGeometry(0.045, 0.012, i % 4 === 0 ? 0.45 : 0.19), lineMaterial, this.platform, Math.sin(a) * (r - 0.36), 0.025, Math.cos(a) * (r - 0.36));
      marker.rotation.y = a;
    }
    const cross = this.mesh(new THREE.BoxGeometry(0.55, 0.012, 0.09), lineMaterial, this.platform, 0, 0.026);
    const cross2 = cross.clone(); cross2.rotation.y = Math.PI / 2; this.platform.add(cross2);
    const underside = this.mesh(new THREE.TorusGeometry(r * 0.88, 0.035, 6, 64), this.material(0xb3ff70, { emissive: 0x89da42, emissiveIntensity: 1 }), this.platform, 0, -0.9);
    underside.rotation.x = Math.PI / 2;
    this.fighters = players.map((player, i) => this.makeFighter(player, player.owner === myId && myId != null, i));
    if (this.preview) {
      this.pose(this.fighters[0], [-1.4, 0.9, 1.7, 0, 1, 7, 0, 0, 0], 12);
      this.pose(this.fighters[1], [1.0, 0.4, -1.1, 0, 1, 0, 0, 0, 0], 0);
    }
    this.layout();
    this.render();
  }

  makeFighter(player, own, i) {
    const root = new THREE.Group(), body = new THREE.Group();
    root.add(body);
    this.world.add(root);
    const suit = this.material(player.color);
    const dark = this.material(0x222b24);
    const glove = this.material(player.color, { roughness: 0.38 });
    this.mesh(new THREE.CapsuleGeometry(0.36, 0.5, 4, 12), suit, body, 0, 0.93);
    this.mesh(new THREE.SphereGeometry(0.4, 16, 12), suit, body, 0, 1.63);
    const visor = this.mesh(new THREE.SphereGeometry(0.32, 12, 8), dark, body, 0, 1.65, 0.22);
    visor.scale.set(1, 0.43, 0.7);
    const eye = this.material(0xf4ffe9, { emissive: 0xb3ff70, emissiveIntensity: 0.2 });
    for (const x of [-0.115, 0.115]) this.mesh(new THREE.BoxGeometry(0.07, 0.06, 0.025), eye, body, x, 1.65, 0.444);
    const legs = [-0.2, 0.2].map(x => {
      const leg = new THREE.Group(); body.add(leg); leg.position.set(x, 0.45, 0);
      this.mesh(new THREE.CapsuleGeometry(0.145, 0.22, 3, 8), dark, leg, 0, -0.1);
      this.mesh(new THREE.BoxGeometry(0.3, 0.2, 0.42), dark, leg, 0, -0.31, 0.07);
      return leg;
    });
    const arms = [-0.48, 0.48].map(x => {
      const arm = new THREE.Group(); body.add(arm); arm.position.set(x, 1.13, 0);
      this.mesh(new THREE.CapsuleGeometry(0.13, 0.2, 3, 8), suit, arm, 0, 0, 0.08);
      this.mesh(new THREE.SphereGeometry(0.245, 12, 8), glove, arm, 0, -0.12, 0.32);
      const cuff = this.mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.11, 10), dark, arm, 0, -0.12, 0.15);
      cuff.rotation.x = Math.PI / 2;
      return arm;
    });
    const indicator = this.mesh(new THREE.RingGeometry(0.52, own ? 0.62 : 0.55, 40), new THREE.MeshBasicMaterial({ color: player.color, transparent: true, opacity: own ? 0.95 : 0.45, side: THREE.DoubleSide }), root, 0, 0.035);
    indicator.rotation.x = -Math.PI / 2;
    const labelCanvas = document.createElement("canvas");
    labelCanvas.width = 256; labelCanvas.height = 64;
    const ctx = labelCanvas.getContext("2d");
    ctx.font = "bold 25px Arial"; ctx.textAlign = "center";
    ctx.fillStyle = "#172014"; ctx.fillRect(10, 8, 236, 46);
    ctx.fillStyle = player.color; ctx.fillText(`${own ? "▼ " : ""}${player.name.slice(0, 16)}`, 128, 40);
    const texture = new THREE.CanvasTexture(labelCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
    label.position.set(0, 2.4, 0); label.scale.set(1.9, 0.475, 1); root.add(label);
    const hit = this.mesh(new THREE.IcosahedronGeometry(0.35, 0), new THREE.MeshBasicMaterial({ color: 0xfff9ce, wireframe: true }), root, 0, 1.3, 0);
    hit.visible = false;
    return { root, body, legs, arms, suit, hit, indicator, label, color: player.color, i };
  }

  pose(fighter, p, tick) {
    const [x, z, angle, damage, alive, attack, dash, , stun] = p;
    fighter.root.visible = !!alive;
    fighter.root.position.set(x, 0, z);
    fighter.body.rotation.y = angle;
    fighter.body.rotation.z = stun ? Math.sin(tick * 2) * 0.14 : 0;
    fighter.body.position.y = dash ? 0.12 : Math.sin(tick * 0.18 + fighter.i) * 0.035;
    fighter.body.scale.set(1, dash ? 0.83 : 1, 1);
    fighter.arms[1].position.z = attack ? Math.sin((9 - attack) / 9 * Math.PI) * 0.7 : 0;
    fighter.arms[0].position.z = attack ? 0.12 : 0;
    fighter.legs[0].rotation.x = Math.sin(tick * 0.6) * (dash ? 0.7 : 0.12);
    fighter.legs[1].rotation.x = -fighter.legs[0].rotation.x;
    fighter.suit.emissive.set(stun ? 0x9f4f25 : 0x000000);
    fighter.hit.visible = stun > 5;
    fighter.hit.rotation.set(tick, tick * 2, 0);
    fighter.hit.scale.setScalar(1 + (9 - stun) * 0.25);
    fighter.indicator.material.opacity = dash ? 1 : 0.6;
  }

  draw(snapshot) {
    this.latest = snapshot;
    this.platform.scale.set(snapshot.r / this.baseRadius, 1, snapshot.r / this.baseRadius);
    snapshot.p.forEach((p, i) => this.pose(this.fighters[i], p, snapshot.k));
    this.requestRender();
  }

  layout() {
    const width = this.canvas.parentElement.clientWidth, height = this.canvas.parentElement.clientHeight;
    this.renderer.setSize(width, height, false);
    const mobile = width < 730;
    let halfHeight = this.preview ? (mobile ? 15.5 : 7.5) : (mobile ? 12.5 : 6.6);
    halfHeight *= this.baseRadius / 5.8;
    const halfWidth = halfHeight * width / height;
    this.camera.left = -halfWidth; this.camera.right = halfWidth;
    this.camera.top = halfHeight; this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();
    this.world.position.set(0, 0, 0);
    this.world.scale.setScalar(1);
    if (this.preview) {
      if (mobile) { this.world.position.set(0.1, 0, -9); this.world.scale.setScalar(0.75); }
      else { this.world.position.set(-0.2, 0, 2.5); this.world.scale.setScalar(1.05); }
    }
  }

  render() { this.renderer.render(this.scene, this.camera); }

  requestRender() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = null; this.render(); });
  }
}
