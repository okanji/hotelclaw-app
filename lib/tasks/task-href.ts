/**
 * The route for a task. Single chokepoint for building task URLs — every link
 * and redirect should go through it instead of hand-assembling
 * `/p/{propertyId}/tasks/{taskId}`.
 */
export function taskHref(propertyId: string, taskId: string): string {
  return `/p/${propertyId}/tasks/${taskId}`;
}
