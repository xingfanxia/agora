import createNextIntlPlugin from 'next-intl/plugin'

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

export default withNextIntl(nextConfig)
