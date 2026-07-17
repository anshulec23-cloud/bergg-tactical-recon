import React, { useEffect, useRef } from "react";
import * as THREE from "three";

export default function ThreeOverlay() {
  const mountRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, mount.clientWidth / mount.clientHeight, 0.1, 1000);
    camera.position.z = 3.5;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    mount.appendChild(renderer.domElement);

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array([
      -0.8, 0.6, 0,
      0.6, 0.8, 0,
      0.9, -0.4, 0,
      -0.5, -0.8, 0,
      0, 0, 0,
    ]);
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: 0x36d7ff, size: 0.06, transparent: true, opacity: 0.85 });
    const points = new THREE.Points(geometry, material);
    scene.add(points);

    const ringGeometry = new THREE.RingGeometry(0.55, 0.58, 64);
    const ringMaterial = new THREE.MeshBasicMaterial({ color: 0x1a8cff, transparent: true, opacity: 0.18, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = Math.PI / 2;
    scene.add(ring);

    let frame;
    const animate = () => {
      points.rotation.z += 0.002;
      ring.scale.setScalar(1 + Math.sin(performance.now() * 0.001) * 0.05);
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    animate();

    const resize = () => {
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener("resize", resize);

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(frame);
      geometry.dispose();
      material.dispose();
      ringGeometry.dispose();
      ringMaterial.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={mountRef} className="three-overlay" aria-hidden="true" />;
}
