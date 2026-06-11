// lib/api/phase.js
import { logger } from '../logger.js';

export function createPhase(onPhase) {
  return (name) => {
    logger.phase(name);
    if (onPhase) onPhase(name);
  };
}