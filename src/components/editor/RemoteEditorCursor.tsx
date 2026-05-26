"use client";

/**
 * RemoteEditorCursor — a small sphere at the remote editor's cursor world
 * position, plus a Billboard name tag floating above it.
 *
 * Design notes:
 * - Sphere radius 0.08 at 16 segments: small enough to not block the scene,
 *   large enough to be visible without looking at it directly.
 * - Billboard + Text reuses the same drei pattern as VisitorAvatar.tsx.
 * - `userData.collidable: false` prevents this sphere from showing up in
 *   the local editor's own cursor raycasts (which would create a feedback
 *   loop where your cursor tracks itself) and in walk-mode collision tests.
 * - `meshBasicMaterial` (unlit) so the cursor color is pure and unaffected
 *   by the scene lighting — it always reads clearly against any scene.
 */

import { Billboard, Text } from "@react-three/drei";

interface Props {
  position: [number, number, number];
  color: string;  // HSL string e.g. "hsl(214, 85%, 60%)"
  name: string;
}

export function RemoteEditorCursor({ position, color, name }: Props) {
  return (
    <group position={position} userData={{ collidable: false }}>
      {/* Cursor sphere */}
      <mesh>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.85} />
      </mesh>

      {/* Floating name tag */}
      <Billboard
        position={[0, 0.18, 0]}
        follow
        lockX={false}
        lockY={false}
        lockZ={false}
      >
        <Text
          fontSize={0.08}
          color="white"
          outlineWidth={0.005}
          outlineColor="black"
          anchorX="center"
          anchorY="middle"
        >
          {name}
        </Text>
      </Billboard>
    </group>
  );
}
