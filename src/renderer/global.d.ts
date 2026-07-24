import type { SgApi } from '../main/preload';

declare global {
  interface Window { sg: SgApi }
}
export {};
