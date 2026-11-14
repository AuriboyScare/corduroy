import { Vector3, type PerspectiveCamera } from 'three/webgpu';

/** Floating name labels over other players' machines, positioned on screen every frame. */
export class NameTags {
  private readonly root = document.createElement('div');
  private readonly tags = new Map<string, HTMLDivElement>();
  private readonly point = new Vector3();

  constructor(parent: HTMLElement) {
    this.root.className = 'name-tags';
    parent.appendChild(this.root);
  }

  /** `players` are the other players with a machine, at the world position above it. */
  update(
    camera: PerspectiveCamera,
    players: readonly { id: string; name: string; x: number; y: number; z: number }[],
  ): void {
    const seen = new Set<string>();
    const width = window.innerWidth;
    const height = window.innerHeight;
    for (const p of players) {
      seen.add(p.id);
      let tag = this.tags.get(p.id);
      if (!tag) {
        tag = document.createElement('div');
        tag.className = 'name-tag';
        this.root.appendChild(tag);
        this.tags.set(p.id, tag);
      }
      if (tag.textContent !== p.name) tag.textContent = p.name;
      const distance = camera.position.distanceTo(this.point.set(p.x, p.y, p.z));
      this.point.project(camera);
      const visible = this.point.z < 1 && Math.abs(this.point.x) < 1.1 && Math.abs(this.point.y) < 1.1;
      tag.style.display = visible ? '' : 'none';
      if (!visible) continue;
      const x = ((this.point.x + 1) / 2) * width;
      const y = ((1 - this.point.y) / 2) * height;
      tag.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
      tag.style.opacity = String(Math.max(0.35, Math.min(1, 1.4 - distance / 600)));
    }
    for (const [id, tag] of this.tags) {
      if (seen.has(id)) continue;
      tag.remove();
      this.tags.delete(id);
    }
  }
}
