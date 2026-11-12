import type { NextConfig } from 'next';

const config: NextConfig = {
  // Catalyst never identifies itself in responses it doesn't have to.
  poweredByHeader: false,
};

export default config;
