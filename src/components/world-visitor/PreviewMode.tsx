"use client";

import { useEffect } from "react";
import { OrbitControls } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import type { SceneGraphV1 } from "@/lib/scene-graph/schema";

interface Props {
  spawn: {
    position: [number, number, number];
    rotation: [number, number, number];
  };
  sceneGraph: SceneGraphV1;
}

// PreviewMode — orbit camera at the authored camera position.
//
// On mount we move the camera to the authored position (sceneGraph.camera)
// rather than the spawn point. That preserves the curator's framing for the
// preview shot. OrbitControls lets the visitor orbit freely from there.
//
// fov is NOT changed here — it was set via the <Canvas camera={{ fov }}>
// prop in WorldVisitor.tsx and does not need to be overridden per mode.
//
// Lint note: camera.position.set() is a method call on the THREE.Object3D
// returned by useThree, which is intentional imperative Three.js. The
// react-hooks/immutability rule flags property assignments; method calls
// (set, copy, etc.) that mutate in-place are the expected Three.js pattern.
export function PreviewMode({ spawn: _spawn, sceneGraph }: Props) {
  const { camera } = useThree();

  useEffect(() => {
    camera.position.set(
      sceneGraph.camera.position[0],
      sceneGraph.camera.position[1],
      sceneGraph.camera.position[2]
    );
    camera.updateProjectionMatrix();
  }, [camera, sceneGraph]);

  return (
    <OrbitControls
      target={sceneGraph.camera.target}
      enableDamping
      dampingFactor={0.05}
      minDistance={0.5}
      maxDistance={50}
    />
  );
}
