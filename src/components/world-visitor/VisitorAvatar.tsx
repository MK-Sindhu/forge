"use client";

// VisitorAvatar — pure presentation component.
// One instance per remote visitor. No Liveblocks hooks here — the parent
// (PresenceLayer) fetches the data and passes it down as props.
//
// Coordinate frame note:
//   presence.position = [camera.x, camera.y, camera.z] where camera.y is at
//   eye-height (spawn.y + EYE_HEIGHT ≈ spawn.y + 1.6). So the group origin is
//   placed at the OTHER visitor's eye level. The capsule body is centered at
//   y = -0.3 relative to the group, meaning:
//     capsule top    ≈ eye-y + 0.3 + 0.5 = just above eyes
//     capsule center ≈ eye-y - 0.3
//     capsule bottom ≈ eye-y - 0.3 - 0.5 - 0.3 = eye-y - 1.1 (floor level
//                       when standing at spawn.y ≈ 0 since eye-y ≈ 1.6)
//   The name tag floats at y = +0.6 above the group (above the capsule top).
//
// userData.collidable = false: the collision.ts filter skips any mesh where
// `userData.collidable === false`, so walk-mode raycasts pass right through
// other visitors' avatars. Without this, you could be physically blocked by
// another user's capsule.

import { Billboard, Text } from "@react-three/drei";

interface Props {
  position: [number, number, number];
  yaw: number;
  name: string;
  color: string; // HSL string from VisitorUserInfo.color, e.g. "hsl(214, 85%, 60%)"
  isGuest: boolean; // reserved for future visual distinction; unused in v1
}

export function VisitorAvatar({ position, yaw, name, color }: Props) {
  return (
    <group
      position={position}
      rotation={[0, yaw, 0]}
      // Mark non-collidable so walk-mode raycasts pass through this avatar.
      // collision.ts checks `userData.collidable !== false` to include a mesh.
      userData={{ collidable: false }}
    >
      {/*
       * Capsule body.
       * CapsuleGeometry args: (radius, height, capSegments, radialSegments)
       * Three.js r168+ constructor: CapsuleGeometry(radius=1, height=1, capSegments=4, radialSegments=8)
       * Total visual height = height + 2*radius = 1.0 + 0.6 = 1.6 m — matches an average humanoid.
       * Center offset at y = -0.3 so the body is mostly below the eye-level origin.
       */}
      <mesh
        position={[0, -0.3, 0]}
        castShadow={false}
        receiveShadow={false}
      >
        <capsuleGeometry args={[0.3, 1.0, 4, 8]} />
        <meshStandardMaterial color={color} roughness={0.6} metalness={0.0} />
      </mesh>

      {/*
       * Name tag floating above the avatar's head.
       * Billboard auto-rotates the child to face the camera on every frame.
       * `follow` (default: true) enables per-frame tracking.
       * lockX/lockY/lockZ all false = full free-axis billboard rotation.
       */}
      <Billboard
        position={[0, 0.6, 0]}
        follow
        lockX={false}
        lockY={false}
        lockZ={false}
      >
        <Text
          fontSize={0.18}
          color="white"
          outlineWidth={0.012}
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
