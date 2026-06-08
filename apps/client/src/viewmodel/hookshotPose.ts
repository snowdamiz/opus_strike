export const HOOKSHOT_HOOK_SOCKET_NAMES = {
  [-1]: 'hookshot.hook.leftTip',
  [1]: 'hookshot.hook.rightTip',
} as const satisfies Record<-1 | 1, string>;
