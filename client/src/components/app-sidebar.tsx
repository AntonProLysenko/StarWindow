import { useState } from 'react';
import { SymbolView } from 'expo-symbols';
import { usePathname, useRouter } from 'expo-router';
import { Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Breakpoints, Palette, Radius, alpha } from '@/constants/tokens';
import * as usersService from '@/utilities/users-service';
import { dvw, dvh } from '@/utilities/responsive-dimensions';

const navItems = [
  {
    label: 'Dashboard',
    href: '/dashboard',
    icon: { ios: 'house.fill', android: 'home', web: 'home' },
  },
  {
    label: 'Calendar',
    href: '/calendar',
    icon: { ios: 'calendar', android: 'calendar_month', web: 'calendar_month' },
  },
  {
    label: 'Map',
    href: '/map',
    icon: { ios: 'map.fill', android: 'map', web: 'map' },
  },
  {
    label: 'Events',
    href: '/events',
    icon: { ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' },
  },
  {
    label: 'Profile',
    href: '/profile',
    icon: { ios: 'person.crop.circle.fill', android: 'person', web: 'person' },
  },
] as const;

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const safeAreaInsets = useSafeAreaInsets();
  const [logoutHovered, setLogoutHovered] = useState(false);
  const isMobile = width < Breakpoints.tablet;
  const isTablet = width >= Breakpoints.tablet && width < Breakpoints.desktop;
  const useIconTabs = isMobile || isTablet;

  const handleLogout = () => {
    usersService.logOut();
    router.replace('/');
  };

  return (
    <View
      style={[
        styles.rail,
        isTablet && styles.tabletRail,
        isMobile && styles.mobileBar,
        isMobile && { paddingBottom: safeAreaInsets.bottom + 8 },
      ]}>
      <View style={[styles.navGroup, isMobile && styles.navGroupMobile]}>
        {!isMobile && (
          <Image
            source={require('@/assets/images/logo_starwindow.png')}
            style={[styles.railLogo, isTablet && styles.railLogoTablet]}
            resizeMode="contain"
          />
        )}

        {navItems.map((item) => {
          const active = pathname === item.href;
          return (
            <Pressable
              key={item.href}
              accessibilityLabel={item.label}
              onPress={() => router.push(item.href)}
              style={[styles.railTab, isTablet && styles.tabletTab, isMobile && styles.mobileTab, active && styles.railTabActive]}>
              {active && <View style={[styles.railTabIndicator, isTablet && styles.tabletTabIndicator, isMobile && styles.mobileTabIndicator]} />}
              {useIconTabs ? (
                <SymbolView
                  name={item.icon}
                  size={24}
                  tintColor={active ? Palette.accent : Palette.textMuted}
                />
              ) : (
                <Text style={[styles.railTabLabel, active && styles.railTabLabelActive]}>
                  {item.label}
                </Text>
              )}
            </Pressable>
          );
        })}
      </View>

      {!isMobile ? (
        <Pressable
          onPress={handleLogout}
          accessibilityLabel="Logout"
          onHoverIn={() => setLogoutHovered(true)}
          onHoverOut={() => setLogoutHovered(false)}
          style={[styles.railTab, isTablet && styles.tabletTab, logoutHovered && styles.logoutTabHovered]}>
          {isTablet ? (
            <SymbolView
              name={{ ios: 'rectangle.portrait.and.arrow.right', android: 'logout', web: 'logout' }}
              size={24}
              tintColor={Palette.accentRed}
            />
          ) : (
            <Text style={styles.logoutLabel}>Logout</Text>
          )}
        </Pressable>
      ) : null}
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
  tabletRail: {
    width: 76,
  },
  mobileBar: {
    width: '100%',
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 0,
    borderRightWidth: 0,
    borderTopWidth: 1,
    borderTopColor: Palette.borderSoft,
  },
  navGroup: {
    alignItems: 'center',
    gap: 4,
  },
  navGroupMobile: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    gap: 4,
  },
  railLogo: {
    width: 72,
    height: 72,
    marginBottom: 16,
  },
  railLogoTablet: {
    width: 48,
    height: 48,
    marginBottom: 18,
  },
  railTab: {
    width: dvw(108),
    height: dvh(44),
    borderRadius: Radius.md,
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  tabletTab: {
    width: 52,
    height: 52,
    alignItems: 'center',
    paddingHorizontal: 0,
  },
  mobileTab: {
    flex: 1,
    width: 'auto',
    minWidth: 44,
    maxWidth: 64,
    height: 48,
    borderRadius: Radius.md,
    alignItems: 'center',
    paddingHorizontal: 0,
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
  tabletTabIndicator: {
    left: -12,
    width: 3,
    height: 24,
    marginTop: -12,
  },
  mobileTabIndicator: {
    left: '50%' as any,
    top: 5,
    marginTop: 0,
    marginLeft: -12,
    width: 24,
    height: 3,
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
