import { StyleSheet, Text, type TextProps } from 'react-native';

import { Palette } from '@/constants/tokens';

/** Text colors screens may pick via the `themeColor` prop. */
const textColors = {
  textPrimary: Palette.textPrimary,
  textSecondary: Palette.textSecondary,
  textMuted: Palette.textMuted,
  accent: Palette.accent,
} as const;

export type ThemedTextProps = TextProps & {
  type?: 'default' | 'title' | 'subtitle' | 'small' | 'smallBold';
  themeColor?: keyof typeof textColors;
};

export function ThemedText({ style, type = 'default', themeColor = 'textPrimary', ...rest }: ThemedTextProps) {
  return (
    <Text
      style={[
        { color: textColors[themeColor] },
        type === 'default' && styles.default,
        type === 'title' && styles.title,
        type === 'subtitle' && styles.subtitle,
        type === 'small' && styles.small,
        type === 'smallBold' && styles.smallBold,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  small: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 500,
  },
  smallBold: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 700,
  },
  default: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: 500,
  },
  title: {
    fontSize: 48,
    fontWeight: 600,
    lineHeight: 52,
  },
  subtitle: {
    fontSize: 32,
    lineHeight: 44,
    fontWeight: 600,
  },
});
