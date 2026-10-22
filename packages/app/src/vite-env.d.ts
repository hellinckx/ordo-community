/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />
declare const __APP_VERSION__: string;
declare module "*.mjs?url" {
  const url: string;
  export default url;
}
