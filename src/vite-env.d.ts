/// <reference types="vite/client" />

/** the commit this build runs, from vite.config.ts's define: null outside a git checkout, undeclared when
 *  the site's own Vite builds the module without it */
declare const __MK1_BUILD__: { commit: string; label: string } | null | undefined;
