// lib/api/phase.js
import { logger } from '../logger.js';

export function createPhase() {
  return (name) => {
    logger.phase(name);
  };
}