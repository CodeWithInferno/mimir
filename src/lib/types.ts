/** Shared plain-data types for the pure libraries in src/lib. No classes, no dependencies. */
export type Vec2 = [number, number]
export type Vec3 = [number, number, number]
/** Axis-aligned rectangle: x,y is the MIN corner (left, bottom in frame space; left, top in screen space). */
export interface Rect { x: number; y: number; width: number; height: number }
/** Axis-aligned box in 3D. */
export interface Box3 { min: Vec3; max: Vec3 }
