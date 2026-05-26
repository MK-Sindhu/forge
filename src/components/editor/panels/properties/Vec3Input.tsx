"use client";

import { useRef, useState, useEffect, KeyboardEvent } from "react";

export interface Vec3InputProps {
  value: [number, number, number];
  onCommit: (next: [number, number, number]) => void;
  precision?: number;
  min?: number;
  /** Optional unit label shown after each input (e.g. "°" for degrees) */
  unit?: string;
}

type AxisIndex = 0 | 1 | 2;
const AXES: ["x", "y", "z"] = ["x", "y", "z"];

/**
 * Three side-by-side number inputs for a 3D vector.
 *
 * Local state strategy: each axis holds its own string so the user can type
 * freely. On blur or Enter on ANY axis, all three are parsed + clamped and
 * onCommit is called once with the full tuple.
 *
 * Sync from props: when the component receives new `value` props (e.g. gizmo
 * drag) AND the input group is not focused, strings are reset. A ref tracks
 * whether any of the three inputs is currently focused.
 */
export function Vec3Input({ value, onCommit, precision = 3, min, unit }: Vec3InputProps) {
  const fmt = (n: number) => Number(n.toFixed(precision)).toString();

  const [strings, setStrings] = useState<[string, string, string]>([
    fmt(value[0]),
    fmt(value[1]),
    fmt(value[2]),
  ]);

  // Track whether any axis input is focused
  const focusedRef = useRef(false);

  // Sync from props when not focused
  useEffect(() => {
    if (!focusedRef.current) {
      setStrings([fmt(value[0]), fmt(value[1]), fmt(value[2])]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value[0], value[1], value[2]]);

  function setAxis(i: AxisIndex, val: string) {
    const next: [string, string, string] = [...strings] as [string, string, string];
    next[i] = val;
    setStrings(next);
  }

  function commit() {
    const parsed = strings.map((s, i) => {
      let n = parseFloat(s);
      if (isNaN(n)) n = value[i]; // fall back to current prop value
      if (min !== undefined) n = Math.max(min, n);
      return n;
    }) as [number, number, number];
    onCommit(parsed);
    // Reformat strings to canonical form after commit
    setStrings([fmt(parsed[0]), fmt(parsed[1]), fmt(parsed[2])]);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.currentTarget.blur();
      commit();
    }
  }

  return (
    <div className="flex gap-1">
      {AXES.map((axis, i) => (
        <div key={axis} className="flex flex-col items-center gap-0.5">
          <label
            className="text-[10px] font-bold uppercase text-zinc-500 leading-none"
            htmlFor={undefined} // axis inputs are visually labeled
            aria-label={axis.toUpperCase()}
          >
            {axis}
          </label>
          <div className="flex items-center gap-0.5">
            <input
              type="number"
              aria-label={axis.toUpperCase()}
              value={strings[i as AxisIndex]}
              step={Math.pow(10, -(precision))}
              className="w-[72px] bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-zinc-100 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              onChange={(e) => setAxis(i as AxisIndex, e.target.value)}
              onFocus={() => { focusedRef.current = true; }}
              onBlur={() => {
                focusedRef.current = false;
                commit();
              }}
              onKeyDown={handleKeyDown}
            />
            {unit && (
              <span className="text-[10px] text-zinc-500">{unit}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
