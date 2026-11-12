// Types for the in-process IMAP test server used by the IMAP tests.
declare module 'hoodiecrow-imap' {
  interface HoodiecrowServer {
    listen(port: number, host: string, callback: () => void): void;
    close(callback?: () => void): void;
    server: { address(): { port: number } };
  }
  export default function hoodiecrow(options: Record<string, unknown>): HoodiecrowServer;
}
