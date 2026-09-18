import * as THREE from 'three';

export type SceneManifest = {
  buildings: { label: string; category: string; bounds: number[] }[];
  interventions: { kind: string; bounds: number[] }[];
};
export type CapturedScene = { image: string; interventions: string; manifest: SceneManifest };

/** Both passes use the identical camera, depth geometry and output dimensions. */
export function captureScene(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): CapturedScene {
  const hidden: THREE.Object3D[] = [], shown: THREE.Object3D[] = [];
  const originals: { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[]; order: number }[] = [];
  const temporary: THREE.Material[] = [];
  const background = scene.background, fog = scene.fog;
  const clearColor = gl.getClearColor(new THREE.Color()), clearAlpha = gl.getClearAlpha();
  const output = document.createElement('canvas');
  const scale = Math.min(1, 1536 / Math.max(gl.domElement.width, gl.domElement.height));
  output.width = Math.max(1, Math.round(gl.domElement.width * scale));
  output.height = Math.max(1, Math.round(gl.domElement.height * scale));
  const context = output.getContext('2d');
  if (!context) throw new Error('Could not capture the scene. Please retry.');
  const snapshot = () => {
    gl.render(scene, camera);
    context.clearRect(0, 0, output.width, output.height);
    context.drawImage(gl.domElement, 0, 0, output.width, output.height);
    return output.toDataURL('image/png');
  };
  const bounds = (object: THREE.Object3D) => {
    const box = new THREE.Box3().setFromObject(object);
    const points: THREE.Vector3[] = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      points.push(new THREE.Vector3(x, y, z).project(camera));
    }
    return [Math.min(...points.map(p => (p.x + 1) / 2)), Math.min(...points.map(p => (1 - p.y) / 2)),
      Math.max(...points.map(p => (p.x + 1) / 2)), Math.max(...points.map(p => (1 - p.y) / 2))]
      .map(n => Math.round(THREE.MathUtils.clamp(n, 0, 1) * 1000) / 1000);
  };
  try {
    scene.traverse(object => {
      if (object.userData.captureHidden && object.visible) { hidden.push(object); object.visible = false; }
      if (object.userData.captureOnly && !object.visible) { shown.push(object); object.visible = true; }
    });
    const image = snapshot();
    const manifest: SceneManifest = { buildings: [], interventions: [] };
    scene.traverseVisible(object => {
      if (object.userData.buildingLabel) manifest.buildings.push({ label: String(object.userData.buildingLabel).slice(0, 160), category: object.userData.buildingCategory, bounds: bounds(object) });
      if (object.userData.intervention) manifest.interventions.push({ kind: object.userData.intervention, bounds: bounds(object) });
      if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Line) && !(object instanceof THREE.Points)) return;
      const mesh = object as THREE.Mesh;
      originals.push({ mesh, material: mesh.material, order: mesh.renderOrder });
      let owner: THREE.Object3D | null = object;
      while (owner && !owner.userData.intervention) owner = owner.parent;
      if (owner) { mesh.renderOrder = 1; return; }
      // Occluders render before additions, writing depth but no color. Hidden
      // roof patches never get painted over nearer buildings or existing trees.
      const material = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, side: THREE.DoubleSide });
      temporary.push(material);
      mesh.material = material;
      mesh.renderOrder = -1000;
    });
    scene.background = null;
    scene.fog = null;
    gl.setClearColor(0x000000, 0);
    const interventions = snapshot();
    return { image, interventions, manifest };
  } finally {
    originals.forEach(({ mesh, material, order }) => { mesh.material = material; mesh.renderOrder = order; });
    temporary.forEach(material => material.dispose());
    scene.background = background;
    scene.fog = fog;
    gl.setClearColor(clearColor, clearAlpha);
    hidden.forEach(object => { object.visible = true; });
    shown.forEach(object => { object.visible = false; });
    gl.render(scene, camera);
  }
}

/** Preserve every visible addition in both the preview and downloaded image. */
export async function composeRealisticView(generated: string, captured: CapturedScene): Promise<string> {
  const images = await Promise.all([generated, captured.interventions].map(async url => {
    const blob = await (await fetch(url)).blob();
    return createImageBitmap(blob);
  }));
  try {
    const [setting, additions] = images;
    const canvas = document.createElement('canvas');
    canvas.width = additions.width; canvas.height = additions.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not preserve your additions. Please retry.');
    // Match the full frame, never crop off a placed intervention.
    context.drawImage(setting, 0, 0, canvas.width, canvas.height);
    context.drawImage(additions, 0, 0);
    return canvas.toDataURL('image/png');
  } finally { images.forEach(image => image.close()); }
}
