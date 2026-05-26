"use client";

import { useRef, useState, useEffect, KeyboardEvent } from "react";
import { useEditorStore } from "../../editor-store";
import { Vec3Input } from "./Vec3Input";

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

/**
 * ObjectTab — displays + edits properties of the currently selected object.
 *
 * No-selection state: shows a muted "Select an object..." prompt.
 * Selection state: name, assetId (read-only), position, rotation (degrees),
 * scale, and a delete button.
 *
 * Debounce strategy: local state + commit on blur (approach A from spec).
 * Number inputs are controlled by Vec3Input which holds its own local string
 * state. Vec3Input calls onCommit on blur/Enter. Name uses local string + blur/Enter.
 */
export function ObjectTab() {
  const selectedObjectId = useEditorStore((s) => s.selectedObjectId);
  const getSelectedObject = useEditorStore((s) => s.getSelectedObject);
  const updateObject = useEditorStore((s) => s.updateObject);
  const deleteSelectedObject = useEditorStore((s) => s.deleteSelectedObject);

  const obj = getSelectedObject();

  if (!selectedObjectId || !obj) {
    return (
      <div className="flex-1 flex items-center justify-center px-4 py-8">
        <p className="text-xs text-zinc-600 italic text-center leading-relaxed">
          Select an object in the viewport to edit it.
        </p>
      </div>
    );
  }

  return (
    <ObjectForm
      key={obj.id}
      obj={obj}
      updateObject={updateObject}
      deleteSelectedObject={deleteSelectedObject}
    />
  );
}

// ---------------------------------------------------------------------------
// ObjectForm — separate component so key= forces full remount on selection change
// ---------------------------------------------------------------------------

interface ObjectFormProps {
  obj: {
    id: string;
    assetId: string;
    name?: string;
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
  };
  updateObject: (
    id: string,
    patch: Partial<{
      position: [number, number, number];
      rotation: [number, number, number];
      scale: [number, number, number];
      name: string;
    }>
  ) => void;
  deleteSelectedObject: () => void;
}

function ObjectForm({ obj, updateObject, deleteSelectedObject }: ObjectFormProps) {
  const [nameValue, setNameValue] = useState(obj.name ?? "");
  const nameIsFocused = useRef(false);

  // Keep name in sync when store changes (e.g., undo) and input isn't focused
  useEffect(() => {
    if (!nameIsFocused.current) {
      setNameValue(obj.name ?? "");
    }
  }, [obj.name]);

  function commitName() {
    const trimmed = nameValue.trim();
    if (trimmed !== (obj.name ?? "")) {
      updateObject(obj.id, { name: trimmed || undefined });
    }
  }

  function handleNameKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.currentTarget.blur();
      commitName();
    }
  }

  function handleDelete() {
    const confirmed = window.confirm(
      `Delete "${obj.name ?? "this object"}"? This cannot be undone once saved.`
    );
    if (confirmed) {
      deleteSelectedObject();
    }
  }

  // Rotation: stored in radians, displayed in degrees
  const rotDeg: [number, number, number] = [
    obj.rotation[0] * RAD_TO_DEG,
    obj.rotation[1] * RAD_TO_DEG,
    obj.rotation[2] * RAD_TO_DEG,
  ];

  function commitRotation(deg: [number, number, number]) {
    updateObject(obj.id, {
      rotation: [
        deg[0] * DEG_TO_RAD,
        deg[1] * DEG_TO_RAD,
        deg[2] * DEG_TO_RAD,
      ],
    });
  }

  return (
    <div className="flex flex-col gap-4 px-3 py-3 overflow-y-auto flex-1">
      {/* Name */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-zinc-400" htmlFor="obj-name-input">
          Name
        </label>
        <input
          id="obj-name-input"
          type="text"
          value={nameValue}
          maxLength={80}
          className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
          onChange={(e) => setNameValue(e.target.value)}
          onFocus={() => { nameIsFocused.current = true; }}
          onBlur={() => {
            nameIsFocused.current = false;
            commitName();
          }}
          onKeyDown={handleNameKeyDown}
          aria-label="Object name"
        />
      </div>

      {/* Asset ID (read-only) */}
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-zinc-400">Asset ID</span>
        <span
          className="text-[10px] font-mono text-zinc-500 truncate"
          title={obj.assetId}
        >
          {obj.assetId}
        </span>
      </div>

      {/* Position */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-zinc-400">Position</span>
        <Vec3Input
          value={obj.position}
          onCommit={(pos) => updateObject(obj.id, { position: pos })}
          precision={3}
        />
      </div>

      {/* Rotation (degrees UI, radians stored) */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-zinc-400">Rotation</span>
        <Vec3Input
          value={rotDeg}
          onCommit={commitRotation}
          precision={1}
          unit="°"
        />
      </div>

      {/* Scale */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-zinc-400">Scale</span>
        <Vec3Input
          value={obj.scale}
          onCommit={(scale) => updateObject(obj.id, { scale })}
          precision={3}
          min={0.01}
        />
      </div>

      {/* Delete */}
      <div className="pt-2 border-t border-zinc-800">
        <button
          type="button"
          onClick={handleDelete}
          className="w-full py-1.5 px-3 rounded text-xs font-medium text-red-400 border border-red-900/50 hover:bg-red-950/50 hover:border-red-700 focus:outline-none focus:ring-2 focus:ring-red-500/40 transition-colors"
        >
          Delete object
        </button>
      </div>
    </div>
  );
}
