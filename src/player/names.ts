// How an object is called when nobody named it. Pure, and imported by both sides of the player (the manifest in the
// main chunk, the chrome in its own), so it stands alone: it imports nothing.
/** intakeValve, intake_valve, intake-valve → "Intake valve": an id as a name, when the scene gave no better one. */
export function prettyName(id: string): string {
  const words = id.replace(/\.[^.]*$/u, (m) => ' ' + m.slice(1)).replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/[_\-.]+/g, ' ').replace(/([A-Za-z])(\d)/g, '$1 $2').trim().toLowerCase()
  return words ? words[0]!.toUpperCase() + words.slice(1) : id
}
/** An id that the engine made up (kind + counter): such an object was not named by the author. */
export const isAutoId = (id: string, kind: string): boolean => new RegExp(`^${kind.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\d+(-\\d+)?$`).test(id)
