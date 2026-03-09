const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Block only the project's supabase/ directory (Edge Functions), not node_modules/@supabase/.
const projectSupabaseDir = path.join(__dirname, 'supabase');
const escaped = projectSupabaseDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\/g, '\\\\');
const blockPattern = '^' + escaped + '[/\\\\]';
const existingBlockList = Array.isArray(config.resolver.blockList) ? config.resolver.blockList : [];
config.resolver.blockList = [new RegExp(blockPattern), ...existingBlockList];

module.exports = config;
