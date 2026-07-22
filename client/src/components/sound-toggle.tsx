import { useEffect, useState } from 'react';
import { SymbolView } from 'expo-symbols';
import { StyleSheet, TouchableOpacity, type StyleProp, type ViewStyle } from 'react-native';

import { Palette, Radius } from '@/constants/tokens';
import * as ambientSound from '@/utilities/ambient-sound-service';

/**
 * Mute/unmute button for the shared space ambience. `floating` pins it to the
 * screen's top-right corner (login); omit it to place the button inline
 * (dashboard top bar).
 */
export function SoundToggle({ floating = false, style }: { floating?: boolean; style?: StyleProp<ViewStyle> }) {
  const [muted, setMuted] = useState(ambientSound.isMuted());

  useEffect(() => ambientSound.subscribe(() => setMuted(ambientSound.isMuted())), []);

  return (
    <TouchableOpacity
      style={[styles.button, floating && styles.floating, style]}
      onPress={() => ambientSound.toggleMuted()}
      activeOpacity={0.8}
      aria-label={muted ? 'Unmute ambience' : 'Mute ambience'}>
      <SymbolView
        name={{
          ios: muted ? 'speaker.slash.fill' : 'speaker.wave.2.fill',
          android: muted ? 'volume_off' : 'volume_up',
          web: muted ? 'volume_off' : 'volume_up',
        }}
        size={18}
        tintColor={Palette.accent}
      />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    borderWidth: 1,
    borderColor: Palette.borderSoft,
    borderRadius: Radius.sm,
    backgroundColor: Palette.bgDeep,
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  floating: {
    position: 'absolute',
    top: 18,
    right: 18,
    zIndex: 10,
  },
});
