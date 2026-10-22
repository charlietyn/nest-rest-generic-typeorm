import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Fixed package-relative build directory; independent of the invoking shell.
rmSync(fileURLToPath(new URL('../dist/', import.meta.url)), { recursive: true, force: true });
