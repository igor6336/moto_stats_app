// Column layout of raw recordings. Shared by the recorder, the exporter and the
// offline tools, so a raw file can be read without the app.
// t is milliseconds since ride start (performance clock), gpsT is the GPS fix
// timestamp, also relative to ride start.

export const RAW_FORMAT = 'moto-raw';
export const RAW_VERSION = 1;

export const GPS_COLUMNS = ['t', 'gpsT', 'lat', 'lon', 'acc', 'alt', 'altAcc', 'speed', 'heading'];
export const MOTION_COLUMNS = ['t', 'ax', 'ay', 'az', 'gx', 'gy', 'gz', 'ra', 'rb', 'rg', 'iv'];
export const ORIENT_COLUMNS = ['t', 'alpha', 'beta', 'gamma'];
export const EVENT_COLUMNS = ['t', 'type', 'data'];

export const UNITS = {
  t: 'ms since ride start',
  gpsT: 'ms since ride start (GPS fix time)',
  lat: 'deg', lon: 'deg',
  acc: 'm (horizontal accuracy)', alt: 'm', altAcc: 'm',
  speed: 'm/s (null if not reported)', heading: 'deg from north (null if not reported)',
  ax: 'm/s2 acceleration without gravity (x)', ay: 'm/s2 (y)', az: 'm/s2 (z)',
  // iOS sign: phone flat face up gives gz = -9.8 (opposite to the W3C spec).
  gx: 'm/s2 accelerationIncludingGravity (x)', gy: 'm/s2 (y)', gz: 'm/s2 (z)',
  // iOS Safari (checked on a car ride vs GPS course, r=0.88): alpha is the
  // rotation about the phone's X axis, beta about Y, gamma about Z, unlike
  // the W3C order. Yaw rate = rotation vector projected on gravity.
  ra: 'rotationRate.alpha, deg/s as reported by browser', rb: 'rotationRate.beta', rg: 'rotationRate.gamma',
  iv: 'DeviceMotionEvent.interval as reported (iOS: seconds)',
  alpha: 'deg', beta: 'deg', gamma: 'deg',
};

export const G = Object.freeze(Object.fromEntries(GPS_COLUMNS.map((c, i) => [c, i])));
export const M = Object.freeze(Object.fromEntries(MOTION_COLUMNS.map((c, i) => [c, i])));
export const O = Object.freeze(Object.fromEntries(ORIENT_COLUMNS.map((c, i) => [c, i])));
