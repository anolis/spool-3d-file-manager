import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
import { GCodeLoader } from 'three/addons/loaders/GCodeLoader.js';
import { Box, LoaderCircle, RotateCcw, ScanLine } from 'lucide-react';
import { type Model, fileUrl } from './types';

const thumbnails = new Map<string, string>();
let thumbnailQueue = Promise.resolve();

interface StepMesh { attributes: { position: { array: number[] }; normal?: { array: number[] } }; index: { array: number[] }; color?: number[] }
export default function Viewer({ item, compact = false }: { item: Model; compact?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const reset = useRef<() => void>(() => {});
  const wireToggle = useRef<(value: boolean) => void>(() => {});
  const [wire, setWire] = useState(false);
  const [thumbnail, setThumbnail] = useState(compact ? thumbnails.get(item.id) || '' : '');
  const [status, setStatus] = useState('Loading preview…');
  const [error, setError] = useState('');
  const [dimensions, setDimensions] = useState('');
  useEffect(() => {
    if (!host.current || item.format === 'zip' || (compact && thumbnails.has(item.id))) return;
    const element = host.current;
    let stopped = false, frame = 0, worker: Worker | undefined;
    let renderer: THREE.WebGLRenderer | undefined;
    const controller = new AbortController();
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#e8eeeb');
    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 10000);
    let controls: OrbitControls | undefined;
    let observer: ResizeObserver | undefined;
    setError(''); setStatus('Loading preview…'); setDimensions(''); setWire(false);
    const disposeScene = () => scene.traverse(child => {
      if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
        child.geometry.dispose();
        for (const mat of (Array.isArray(child.material) ? child.material : [child.material])) mat.dispose();
      }
    });
    async function load() {
      let release: (() => void) | undefined;
      if (compact) {
        const previous = thumbnailQueue;
        thumbnailQueue = new Promise<void>(resolve => { release = resolve; });
        await previous;
      }
      try {
        if (stopped) return;
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, compact ? 1.5 : 2));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        element.appendChild(renderer.domElement);
        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true; controls.enablePan = !compact; controls.enableZoom = !compact;
        controls.autoRotate = compact; controls.autoRotateSpeed = 0.5;
        scene.add(new THREE.HemisphereLight(0xffffff, 0x7a8c83, 3));
        const sun = new THREE.DirectionalLight(0xffffff, 3.5); sun.position.set(-100, 200, 100); scene.add(sun);
        const fill = new THREE.DirectionalLight(0xc8e2d4, 2); fill.position.set(150, 40, -100); scene.add(fill);
        const response = await fetch(fileUrl(item), { signal: controller.signal });
        if (!response.ok) throw new Error('The model file is unavailable.');
        const data = await response.arrayBuffer();
        if (stopped) return;
        let object: THREE.Object3D;
        const material = () => new THREE.MeshStandardMaterial({ color: '#569580', roughness: 0.57, metalness: 0.12, side: THREE.DoubleSide });
        if (item.format === 'stl') {
          const geometry = new STLLoader().parse(data); geometry.computeVertexNormals();
          if (!geometry.attributes.position?.count) throw new Error('This STL contains no triangles.');
          object = new THREE.Mesh(geometry, material());
        } else if (item.format === '3mf') object = new ThreeMFLoader().parse(data);
        else if (item.format === 'gcode') object = new GCodeLoader().parse(new TextDecoder().decode(data));
        else {
          setStatus('Converting STEP geometry…');
          const meshes = await new Promise<StepMesh[]>((resolve, reject) => {
            worker = new Worker('/step-worker.js');
            worker.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data.meshes);
            worker.onerror = () => reject(new Error('STEP preview engine could not start.'));
            controller.signal.addEventListener('abort', () => reject(new Error('Preview cancelled.')), { once: true });
            worker.postMessage(data, [data]);
          });
          worker?.terminate();
          if (stopped) return;
          const group = new THREE.Group();
          for (const mesh of meshes) {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.attributes.position.array, 3));
            geometry.setIndex(mesh.index.array); geometry.computeVertexNormals();
            const mat = material(); if (mesh.color) mat.color.setRGB(...mesh.color as [number, number, number]);
            group.add(new THREE.Mesh(geometry, mat));
          }
          object = group;
        }
        // Printer models conventionally use Z as up. Show them upright in Three's Y-up scene.
        object.rotation.x = -Math.PI / 2;
        object.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(object);
        if (box.isEmpty()) throw new Error('This file contains no previewable geometry.');
        const size = box.getSize(new THREE.Vector3());
        if (![size.x, size.y, size.z].every(Number.isFinite) || Math.max(size.x, size.y, size.z) <= 0) throw new Error('Invalid model dimensions.');
        const center = box.getCenter(new THREE.Vector3());
        object.position.sub(center); scene.add(object);
        const extent = Math.max(size.x, size.y, size.z);
        setDimensions(`${size.x.toFixed(1)} × ${size.z.toFixed(1)} × ${size.y.toFixed(1)} ${['stl','gcode','3mf'].includes(item.format) ? 'units' : 'mm'}`);
        const grid = new THREE.GridHelper(extent * 2.2, 16, '#b9c8c0', '#d1dcd5'); grid.position.y = -size.y/2 - extent*0.002; scene.add(grid);
        const resetView = () => {
          const aspect = element.clientWidth / Math.max(1, element.clientHeight);
          const distance = extent * 2.1 * Math.max(1, 1/aspect);
          camera.position.set(distance*0.85, distance*0.63, distance*0.95);
          camera.near = Math.max(extent/1000, 0.001); camera.far = extent*100; camera.updateProjectionMatrix();
          controls!.target.set(0, 0, 0); controls!.update();
        };
        reset.current = resetView; resetView();
        wireToggle.current = value => object.traverse(child => {
          if (child instanceof THREE.Mesh) for (const mat of (Array.isArray(child.material) ? child.material : [child.material])) if ('wireframe' in mat) (mat as THREE.MeshStandardMaterial).wireframe = value;
        });
        setStatus('');
        if (compact) {
          renderer.setSize(element.clientWidth, element.clientHeight);
          camera.aspect = element.clientWidth / Math.max(1, element.clientHeight); camera.updateProjectionMatrix();
          renderer.render(scene, camera);
          const thumbnailUrl = renderer.domElement.toDataURL('image/webp', 0.8);
          if (thumbnails.size >= 120) thumbnails.delete(thumbnails.keys().next().value!);
          thumbnails.set(item.id, thumbnailUrl); setThumbnail(thumbnailUrl);
          controls.dispose(); disposeScene(); renderer.dispose(); renderer.forceContextLoss();
          element.removeChild(renderer.domElement); renderer = undefined;
          return;
        }
        observer = new ResizeObserver(() => {
          if (!renderer || stopped) return;
          renderer.setSize(element.clientWidth, element.clientHeight);
          camera.aspect = element.clientWidth / Math.max(1, element.clientHeight); camera.updateProjectionMatrix();
        }); observer.observe(element);
        const render = () => { if (stopped || !renderer) return; controls!.update(); renderer.render(scene, camera); frame = requestAnimationFrame(render); }; render();
      } catch (err) { if (!stopped) { setError(err instanceof Error ? err.message : 'Preview unavailable.'); setStatus(''); } } finally { release?.(); }
    }
    void load();
    return () => {
      stopped = true; controller.abort(); worker?.terminate(); cancelAnimationFrame(frame); observer?.disconnect(); controls?.dispose();
      disposeScene();
      renderer?.dispose(); renderer?.forceContextLoss(); if (renderer?.domElement.parentNode === element) element.removeChild(renderer.domElement);
    };
  }, [item.id, item.format, compact]);
  if (item.format === 'zip') return <div className="archive-art"><Box size={66} strokeWidth={1}/><span>ZIP ARCHIVE</span><p>Add to collection to inspect its models</p></div>;
  return <div className={`viewer ${compact ? 'compact' : ''}`}>
    <div className="canvas-host" ref={host}/>{thumbnail && compact && <img className="rendered-thumbnail" src={thumbnail} alt="3D model preview"/>}
    {!thumbnail && (status || error) && <div className={`viewer-message ${error ? 'preview-error' : ''}`}>{error ? <Box size={30}/> : <LoaderCircle className="spin" size={24}/>}<span>{error || status}</span></div>}
    {!compact && !error && !status && <><div className="viewer-toolbar"><button title="Reset view" aria-label="Reset view" onClick={() => reset.current()}><RotateCcw size={17}/></button><button className={wire ? 'selected' : ''} title="Toggle wireframe" aria-label="Toggle wireframe" onClick={() => { setWire(!wire); wireToggle.current(!wire); }}><ScanLine size={17}/></button></div><div className="viewer-caption"><span>Drag to orbit · Scroll to zoom · Right-drag to pan</span><span>{dimensions}</span></div></>}
  </div>;
}
