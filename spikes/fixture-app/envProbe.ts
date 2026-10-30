// Spike 2: which process.env access patterns does babel-preset-expo inline?
// Each variable has a unique value; grep the exported bundle for it.

const key = 'EXPO_PUBLIC_DYNAMIC';
const env = process.env;
const { EXPO_PUBLIC_DESTRUCT } = process.env;

export const probe = {
  dot: process.env.EXPO_PUBLIC_DOT,
  bracket: process.env['EXPO_PUBLIC_BRACKET'],
  destruct: EXPO_PUBLIC_DESTRUCT,
  dynamic: process.env[key],
  alias: env.EXPO_PUBLIC_ALIAS,
  optional: process.env?.EXPO_PUBLIC_OPTIONAL,
  template: `${process.env.EXPO_PUBLIC_TEMPLATE}`,
  whole: JSON.stringify(process.env),
  privateDot: process.env.PRIVATE_DOT,
  order: process.env.EXPO_PUBLIC_ORDER,
  undefinedVar: process.env.EXPO_PUBLIC_NOT_DEFINED_ANYWHERE,
};
