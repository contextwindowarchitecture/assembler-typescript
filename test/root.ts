import { fileURLToPath } from 'node:url';

// Tests compile to build/test/, two levels below the repository root.
export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
