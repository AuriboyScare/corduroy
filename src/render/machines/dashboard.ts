import { CanvasTexture, MeshStandardNodeMaterial, SRGBColorSpace } from 'three/webgpu';
import type { Snowcat } from '../../sim/vehicles/snowcat';

const W = 512;
const H = 288;
const FONT = '"Barlow Condensed", "Arial Narrow", Arial, sans-serif';

/**
 * The cab's main display, drawn on a canvas from the machine's live state: speed, engine,
 * blade and tiller positions, blade load and winch. Redrawn a few times a second while driven.
 */
export class Dashboard {
  readonly material: MeshStandardNodeMaterial;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: CanvasTexture;
  private since = 1;

  constructor(private readonly title: string) {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    this.ctx = canvas.getContext('2d')!;
    this.texture = new CanvasTexture(canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.material = new MeshStandardNodeMaterial({
      color: 0x000000,
      emissive: 0xffffff,
      emissiveMap: this.texture,
      emissiveIntensity: 0.9,
      roughness: 0.2,
    });
    this.standby();
  }

  /** Dim logo screen while the machine is parked. */
  standby(): void {
    const c = this.ctx;
    c.fillStyle = '#05080b';
    c.fillRect(0, 0, W, H);
    c.fillStyle = '#3d4a57';
    c.font = `700 44px ${FONT}`;
    c.textAlign = 'center';
    c.fillText(this.title.toUpperCase(), W / 2, H / 2 + 14);
    c.textAlign = 'left';
    this.texture.needsUpdate = true;
    this.since = 1;
  }

  update(dt: number, cat: Snowcat, rpm: number): void {
    this.since += dt;
    if (this.since < 0.25) return;
    this.since = 0;
    const c = this.ctx;
    c.fillStyle = '#05090d';
    c.fillRect(0, 0, W, H);
    // Header strip.
    c.fillStyle = '#0f1923';
    c.fillRect(0, 0, W, 34);
    c.fillStyle = '#f4b52f';
    c.font = `700 22px ${FONT}`;
    c.fillText(this.title.toUpperCase(), 14, 24);
    c.fillStyle = '#8fa3b6';
    c.textAlign = 'right';
    c.fillText(`${Math.round(cat.body.py)} M`, W - 14, 24);
    c.textAlign = 'left';

    // Speed.
    const kmh = Math.abs(cat.forwardSpeed * 3.6);
    c.fillStyle = '#eef4f9';
    c.font = `700 92px ${FONT}`;
    c.fillText(kmh.toFixed(1), 18, 128);
    c.fillStyle = '#71859a';
    c.font = `600 22px ${FONT}`;
    c.fillText(cat.forwardSpeed < -0.1 ? 'KM/H  REV' : 'KM/H', 22, 156);

    // Engine speed and load bars.
    const bar = (y: number, label: string, value: number, warn: number) => {
      c.fillStyle = '#71859a';
      c.font = `600 18px ${FONT}`;
      c.fillText(label, 18, y - 6);
      c.fillStyle = '#16212c';
      c.fillRect(18, y, 200, 12);
      c.fillStyle = value >= 1 ? '#ff5d55' : value >= warn ? '#ffa53d' : '#5fd39c';
      c.fillRect(18, y, 200 * Math.max(0, Math.min(1, value)), 12);
    };
    bar(196, `ENGINE ${Math.round(rpm / 10) * 10} RPM`, rpm / 2400, 0.88);
    bar(240, `LOAD ${Math.round(cat.engineLoad * 100)}%`, cat.engineLoad, 0.85);

    // Side view of the machine with blade height and tiller position.
    const ox = 268;
    const oy = 170;
    c.strokeStyle = '#3b4a59';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(ox - 20, oy + 46);
    c.lineTo(ox + 200, oy + 46);
    c.stroke();
    c.fillStyle = '#2a3644';
    c.beginPath();
    c.roundRect(ox + 40, oy + 26, 110, 18, 9);
    c.fill();
    c.fillStyle = '#f4b52f';
    c.fillRect(ox + 60, oy - 6, 70, 32);
    c.fillRect(ox + 100, oy - 30, 38, 26);
    const bladeY = oy + 40 - Math.max(-0.3, Math.min(1.2, cat.bladeHeightM)) * 40;
    c.fillRect(ox + 166, bladeY - 34, 10, 36);
    c.strokeStyle = '#f4b52f';
    c.lineWidth = 4;
    c.beginPath();
    c.moveTo(ox + 148, oy + 28);
    c.lineTo(ox + 168, bladeY - 14);
    c.stroke();
    const tillerDrop = cat.tillerPos * 22;
    c.beginPath();
    c.moveTo(ox + 44, oy + 20);
    c.lineTo(ox + 14, oy + 16 + tillerDrop);
    c.stroke();
    c.fillStyle = cat.tillerWorking ? '#5fd39c' : '#71859a';
    c.beginPath();
    c.arc(ox + 6, oy + 18 + tillerDrop, 12, 0, Math.PI * 2);
    c.fill();

    // Blade load and implement states.
    c.font = `600 18px ${FONT}`;
    c.fillStyle = '#71859a';
    c.fillText('BLADE', ox - 10, 64);
    c.fillText('TILLER', ox + 118, 64);
    c.fillStyle = '#eef4f9';
    c.font = `700 30px ${FONT}`;
    const h = Math.round(cat.bladeHeightM * 100);
    c.fillText(`${h >= 0 ? '+' : ''}${h} CM`, ox - 10, 96);
    c.fillStyle = cat.tillerWorking ? '#5fd39c' : '#eef4f9';
    c.fillText(cat.tillerWorking ? 'WORKING' : cat.tillerPos > 0.5 ? 'DOWN' : 'RAISED', ox + 118, 96);
    c.fillStyle = '#71859a';
    c.font = `600 18px ${FONT}`;
    c.fillText(`${Math.round(cat.bladeLoadKg)} KG CARRIED`, ox - 10, 122);
    if (cat.spec.winchPullN > 0) {
      c.fillText(
        cat.winchCableOutM > 0
          ? `WINCH ${Math.round(cat.winchCableOutM)} M  ${Math.round(cat.winchForceN / 1000)} KN`
          : 'WINCH STOWED',
        ox + 118,
        122,
      );
    }
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
  }
}
