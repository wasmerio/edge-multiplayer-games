// Single source for every tunable. The worklog README mirrors this table;
// nothing else in the engine or in a game may restate one of these values.
export const ENGINE_VERSION = "1.0.0";
export const PROTOCOL_VERSION = 1;

export const DEFAULT_TICK_HZ = 30;
export const MAX_TICK_HZ = 60;
export const MAX_CATCHUP_TICKS = 5;

export const MAX_PLAYERS_PER_ROOM = 8;
export const MAX_SPECTATORS_PER_ROOM = 8;
export const ROOM_CODE_LENGTH = 4;
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROOM_IDLE_TTL_MS = 15 * 60 * 1000;
export const REJOIN_GRACE_MS = 60 * 1000;
export const SIGNAL_PING_INTERVAL_MS = 20 * 1000;
export const WS_MAX_PAYLOAD_BYTES = 64 * 1024;
export const PLAYER_NAME_MAX_CHARS = 16;

export const SNAPSHOT_BUDGET_BYTES = 100;
export const INPUT_RESEND_INTERVAL_MS = 1000;
export const INTERP_BUFFER_TICKS = 3;

export const ASSET_SET_VERSION = "1.0.0";
export const AUDIO_MAX_VOICES = 16;
export const DIAG_SAMPLE_INTERVAL_MS = 1000;
export const DIAG_WINDOW_SAMPLES = 60;
export const SOAK_DURATION_MS = 10 * 60 * 1000;
export const SOAK_TICK_TOLERANCE = 0.1;
export const SOAK_SETUP_TIMEOUT_MS = 30 * 1000;
export const SOAK_MEMORY_SAMPLES = 10;
export const SOAK_MEMORY_GROWTH_BYTES = 4 * 1024 * 1024;

export const SUPERAPP_ORIGIN = "https://edge-multiplayer-games.wasmer.app";
