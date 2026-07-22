import { useState } from 'react';
import { usePathname, useRouter } from 'expo-router';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { Palette, Radius, alpha } from '@/constants/tokens';
import * as usersService from '@/utilities/users-service';
import { dvw, dvh } from '@/utilities/responsive-dimensions';

const navItems = [
  { label: 'Dashboard', href: '/dashboard' },
  { label: 'Calendar', href: '/calendar' },
  { label: 'Map', href: '/map' },
  { label: 'Events', href: '/events' },
  { label: 'Profile', href: '/profile' },
] as const;

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [logoutHovered, setLogoutHovered] = useState(false);

  const handleLogout = () => {
    usersService.logOut();
    router.replace('/');
  };

  return (
    <View style={styles.rail}>
      <View style={styles.navGroup}>
        <Image
          source={require('@/assets/images/logo_starwindow.png')}
          style={styles.railLogo}
          resizeMode="contain"
        />

        {navItems.map((item) => {
          const active = pathname === item.href;
          return (
            <Pressable
              key={item.href}
              onPress={() => router.push(item.href)}
              style={[styles.railTab, active && styles.railTabActive]}>
              {active && <View style={styles.railTabIndicator} />}
              <Text style={[styles.railTabLabel, active && styles.railTabLabelActive]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Pressable
        onPress={handleLogout}
        onHoverIn={() => setLogoutHovered(true)}
        onHoverOut={() => setLogoutHovered(false)}
        style={[styles.railTab, logoutHovered && styles.logoutTabHovered]}>
        <Text style={styles.logoutLabel}>Logout</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  rail: {
    width: dvw(128),
    backgroundColor: Palette.bgDeep,
    borderRightWidth: 1,
    borderRightColor: Palette.borderSoft,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
  },
  navGroup: {
    alignItems: 'center',
    gap: 4,
  },
  railLogo: {
    width: 72,
    height: 72,
    marginBottom: 16,
  },
  railTab: {
    width: dvw(108),
    height: dvh(44),
    borderRadius: Radius.md,
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  railTabActive: {
    backgroundColor: Palette.surfaceRaised,
  },
  railTabIndicator: {
    position: 'absolute',
    left: -10,
    top: '50%',
    marginTop: -10,
    width: dvw(3),
    height: dvh(20),
    backgroundColor: Palette.accent,
    borderRadius: 3,
  },
  railTabLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Palette.textTertiary,
    textTransform: 'uppercase',
  },
  railTabLabelActive: {
    color: Palette.accent,
  },
  logoutTabHovered: {
    backgroundColor: alpha(Palette.accentRed, 0.08),
  },
  logoutLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Palette.accentRed,
    textTransform: 'uppercase',
  },
});
