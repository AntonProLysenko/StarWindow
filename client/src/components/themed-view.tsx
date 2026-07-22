import { View, type ViewProps } from 'react-native';

import { Palette } from '@/constants/tokens';

/**
 * View with the app's space-black background. Override `backgroundColor` in
 * `style` (with a Palette token) for raised surfaces.
 */
export function ThemedView({ style, ...otherProps }: ViewProps) {
  return <View style={[{ backgroundColor: Palette.bgVoid }, style]} {...otherProps} />;
}
