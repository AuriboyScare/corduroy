/**
 * Single rigid body with a diagonal inertia tensor in its own frame. Scalar fields and no
 * allocation, because vehicles step this several times per frame.
 */
export class RigidBody {
  px = 0;
  py = 0;
  pz = 0;
  qx = 0;
  qy = 0;
  qz = 0;
  qw = 1;
  vx = 0;
  vy = 0;
  vz = 0;
  /** Angular velocity, world frame, rad/s. */
  wx = 0;
  wy = 0;
  wz = 0;
  /** Result of the last toWorld / toBody / pointVelocity call. */
  ox = 0;
  oy = 0;
  oz = 0;
  private fx = 0;
  private fy = 0;
  private fz = 0;
  private tx = 0;
  private ty = 0;
  private tz = 0;

  constructor(
    public mass: number,
    public ix: number,
    public iy: number,
    public iz: number,
  ) {}

  /** Changes mass and principal moments of inertia (body frame), keeping position and motion. */
  setMass(mass: number, ix: number, iy: number, iz: number): void {
    this.mass = mass;
    this.ix = ix;
    this.iy = iy;
    this.iz = iz;
  }

  /** Rotates a body-frame vector into the world frame (result in ox, oy, oz). */
  toWorld(x: number, y: number, z: number): void {
    this.rotate(x, y, z, this.qx, this.qy, this.qz);
  }

  /** Rotates a world-frame vector into the body frame (result in ox, oy, oz). */
  toBody(x: number, y: number, z: number): void {
    this.rotate(x, y, z, -this.qx, -this.qy, -this.qz);
  }

  private rotate(x: number, y: number, z: number, qx: number, qy: number, qz: number): void {
    const qw = this.qw;
    const cx = qy * z - qz * y;
    const cy = qz * x - qx * z;
    const cz = qx * y - qy * x;
    this.ox = x + 2 * (qw * cx + qy * cz - qz * cy);
    this.oy = y + 2 * (qw * cy + qz * cx - qx * cz);
    this.oz = z + 2 * (qw * cz + qx * cy - qy * cx);
  }

  /** Velocity of a world-space point fixed to the body (result in ox, oy, oz). */
  pointVelocity(x: number, y: number, z: number): void {
    const rx = x - this.px;
    const ry = y - this.py;
    const rz = z - this.pz;
    this.ox = this.vx + this.wy * rz - this.wz * ry;
    this.oy = this.vy + this.wz * rx - this.wx * rz;
    this.oz = this.vz + this.wx * ry - this.wy * rx;
  }

  /** Accumulates a world-frame force acting at a world-space point. */
  applyForceAt(fx: number, fy: number, fz: number, x: number, y: number, z: number): void {
    this.fx += fx;
    this.fy += fy;
    this.fz += fz;
    const rx = x - this.px;
    const ry = y - this.py;
    const rz = z - this.pz;
    this.tx += ry * fz - rz * fy;
    this.ty += rz * fx - rx * fz;
    this.tz += rx * fy - ry * fx;
  }

  /** Semi-implicit Euler step; clears accumulated forces. */
  integrate(dt: number, gravity: number): void {
    this.vx += (this.fx / this.mass) * dt;
    this.vy += (this.fy / this.mass - gravity) * dt;
    this.vz += (this.fz / this.mass) * dt;

    // Euler's equations in the body frame, where the inertia tensor is diagonal.
    this.toBody(this.tx, this.ty, this.tz);
    const tbx = this.ox;
    const tby = this.oy;
    const tbz = this.oz;
    this.toBody(this.wx, this.wy, this.wz);
    let wbx = this.ox;
    let wby = this.oy;
    let wbz = this.oz;
    const ax = (tbx - (this.iz - this.iy) * wby * wbz) / this.ix;
    const ay = (tby - (this.ix - this.iz) * wbz * wbx) / this.iy;
    const az = (tbz - (this.iy - this.ix) * wbx * wby) / this.iz;
    wbx += ax * dt;
    wby += ay * dt;
    wbz += az * dt;
    this.toWorld(wbx, wby, wbz);
    this.wx = this.ox;
    this.wy = this.oy;
    this.wz = this.oz;

    this.px += this.vx * dt;
    this.py += this.vy * dt;
    this.pz += this.vz * dt;

    const { qx, qy, qz, qw, wx, wy, wz } = this;
    const h = 0.5 * dt;
    let nx = qx + h * (wx * qw + wy * qz - wz * qy);
    let ny = qy + h * (wy * qw + wz * qx - wx * qz);
    let nz = qz + h * (wz * qw + wx * qy - wy * qx);
    let nw = qw - h * (wx * qx + wy * qy + wz * qz);
    const inv = 1 / Math.hypot(nx, ny, nz, nw);
    nx *= inv;
    ny *= inv;
    nz *= inv;
    nw *= inv;
    this.qx = nx;
    this.qy = ny;
    this.qz = nz;
    this.qw = nw;

    this.fx = this.fy = this.fz = 0;
    this.tx = this.ty = this.tz = 0;
  }

  /** Turns the body by `angle` about one of its own (body-frame) unit axes. */
  rotateLocal(ax: number, ay: number, az: number, angle: number): void {
    const s = Math.sin(angle / 2);
    const bx = ax * s;
    const by = ay * s;
    const bz = az * s;
    const bw = Math.cos(angle / 2);
    const { qx, qy, qz, qw } = this;
    this.qx = qw * bx + qx * bw + qy * bz - qz * by;
    this.qy = qw * by - qx * bz + qy * bw + qz * bx;
    this.qz = qw * bz + qx * by - qy * bx + qz * bw;
    this.qw = qw * bw - qx * bx - qy * by - qz * bz;
  }

  /** Sets orientation to a rotation about +y (heading) and zeroes motion. */
  reset(x: number, y: number, z: number, heading: number): void {
    this.px = x;
    this.py = y;
    this.pz = z;
    this.qx = 0;
    this.qy = Math.sin(heading / 2);
    this.qz = 0;
    this.qw = Math.cos(heading / 2);
    this.vx = this.vy = this.vz = 0;
    this.wx = this.wy = this.wz = 0;
  }
}
