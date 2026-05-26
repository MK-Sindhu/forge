/**
 * Route-segment layout for the editor page.
 *
 * This layout intentionally overrides the root layout's header + footer so
 * the editor can occupy the full viewport (h-screen overflow-hidden) without
 * the global nav/footer competing for vertical space.
 *
 * The root layout adds a sticky header (~48px) and footer (~80px). If the
 * editor page relied on the root layout, the <EditorShell>'s h-screen would
 * still include those bars, shrinking the three-panel layout. By replacing
 * the root layout entirely at this route segment, the editor gets a clean
 * full-bleed context — identical to how fullscreen editors work in tools like
 * Figma and Blender (separate window / no chrome).
 *
 * This is a server component (no "use client" directive).
 */

export default function EditLayout({ children }: { children: React.ReactNode }) {
  // No ClerkProvider wrapping needed — it's already in the root layout's HTML
  // shell. Route-segment layouts in Next.js App Router do NOT re-nest HTML/body.
  // This component just replaces the layout's content (header + main + footer)
  // without affecting the ClerkProvider, font variables, or global CSS.
  return <>{children}</>;
}
