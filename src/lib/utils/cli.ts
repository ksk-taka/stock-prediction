/**
 * CLI utilities - 共通ユーティリティ関数
 */

/**
 * 指定ミリ秒待機
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * CLIフラグの値を取得
 * @example parseFlag(['--limit', '10'], '--limit') // '10'
 * @example parseFlag(['--limit=10'], '--limit') // '10'
 */
export function parseFlag(args: string[], flag: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    // --flag=value 形式
    if (arg.startsWith(`${flag}=`)) {
      return arg.slice(flag.length + 1);
    }
    // --flag value 形式
    if (arg === flag && i + 1 < args.length && !args[i + 1].startsWith('-')) {
      return args[i + 1];
    }
  }
  return undefined;
}

/**
 * フラグの存在確認
 * @example hasFlag(['--dry-run', '--verbose'], '--dry-run') // true
 */
export function hasFlag(args: string[], flag: string): boolean {
  return args.some((arg) => arg === flag || arg.startsWith(`${flag}=`));
}

/**
 * process.argv から引数を取得（node と script パスを除く）
 */
export function getArgs(): string[] {
  return process.argv.slice(2);
}

/**
 * フラグの数値を取得
 * @example parseIntFlag(['--limit', '10'], '--limit', 5) // 10
 * @example parseIntFlag(['--limit=20'], '--limit', 5) // 20
 * @example parseIntFlag([], '--limit', 5) // 5 (default)
 */
export function parseIntFlag(args: string[], flag: string, defaultValue: number): number {
  const value = parseFlag(args, flag);
  if (value === undefined) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * 位置引数を取得（フラグでない最初の引数）
 * @example getPositionalArg(['7203.T', '--verbose']) // '7203.T'
 * @example getPositionalArg(['--verbose', '7203.T']) // '7203.T'
 */
export function getPositionalArg(args: string[], index: number = 0): string | undefined {
  const positionals = args.filter((arg) => !arg.startsWith("-"));
  return positionals[index];
}
