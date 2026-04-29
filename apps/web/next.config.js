import createNextIntlPlugin from 'next-intl/plugin'
import { withWorkflow } from 'workflow/next'

const withNextIntl = createNextIntlPlugin('./i18n/request.ts')

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@agora/shared', '@agora/core', '@agora/llm'],
  serverExternalPackages: ['@ai-sdk/anthropic', '@ai-sdk/openai', '@ai-sdk/google'],
  webpack: (config) => {
    // Workspace packages use .js extensions in imports (NodeNext convention)
    // but the actual source files are .ts — tell webpack to try .ts first
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.js'],
      '.jsx': ['.tsx', '.jsx'],
    }
    return config
  },
}

// Phase 4.5d-2.2 — WDK substrate. withWorkflow enables the
// "use workflow" + "use step" directives at compile time. Order
// matters: withWorkflow returns an async function, so it must be
// the outermost wrapper. withNextIntl returns a sync NextConfig.
// Each wrapper preserves the inner webpack callback by chaining;
// our `extensionAlias` callback survives both.
export default withWorkflow(withNextIntl(nextConfig))
