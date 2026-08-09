import { DarkTheme, DefaultTheme, ThemeProvider, Stack, usePathname, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View, useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AppSidebar } from '@/components/app-sidebar';
import { Breakpoints, Palette } from '@/constants/tokens';
import { EventsProvider } from '@/context/events-context';
import * as usersService from '@/utilities/users-service';
import { dvw } from '@/utilities/responsive-dimensions';
import { useReliableWindowWidth } from '@/utilities/use-reliable-window-width';

// export default function TabLayout() {
//   const colorScheme = useColorScheme();
//   return (
//     <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
//       <AnimatedSplashOverlay />
//       <AppTabs />
//     </ThemeProvider>
//   );
// }

export default function RootLayout() {
    const colorScheme = useColorScheme();
    const width = useReliableWindowWidth();
    const router = useRouter();
    const pathname = usePathname();
    const [currentUser, setCurrentUser] = useState<usersService.AuthUser | null>(() => usersService.getUser());
    const isLoggedIn = Boolean(currentUser);
    const showSidebar = isLoggedIn && pathname !== '/signup' && pathname !== '/login';
    const isPublicRoute = pathname === '/' || pathname === '/login' || pathname === '/signup';
    const isMobile = width < Breakpoints.tablet;

    useEffect(() => {
      const syncAuthState = () => {
        setCurrentUser(usersService.getUser());
      };

      const unsubscribe = usersService.subscribeAuthChanges(syncAuthState);
      if (typeof window !== 'undefined') {
        window.addEventListener('storage', syncAuthState);
      }
      syncAuthState();

      return () => {
        unsubscribe();
        if (typeof window !== 'undefined') {
          window.removeEventListener('storage', syncAuthState);
        }
      };
    }, []);

    useEffect(() => {
      if (!isLoggedIn && !isPublicRoute) {
        router.replace('/');
      }
    }, [isLoggedIn, isPublicRoute, router]);

    return (
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <EventsProvider enabled={isLoggedIn}>
          <AnimatedSplashOverlay />
          <View style={[styles.shell, isMobile && styles.shellMobile]} testID="app-shell">
            {showSidebar && <AppSidebar />}
            <View style={[styles.content, isMobile && showSidebar && styles.contentWithMobileNav]} testID="app-content">
              <Stack screenOptions={{ headerShown: false }} />
            </View>
          </View>
        </EventsProvider>
      </ThemeProvider>
    );
  }

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: Palette.bgVoid,
    overflow: 'hidden',
    height: Platform.OS === 'web' ? '100dvh' as any : undefined,
    minHeight: Platform.OS === 'web' ? '100dvh' as any : undefined,
  },
  shellMobile: {
    flexDirection: 'column',
  },
  content: {
    flex: 1,
    minWidth: dvw(0),
    minHeight: 0,
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: Palette.bgVoid,
  },
  contentWithMobileNav: {
    paddingBottom: Platform.OS === 'web'
      ? 'calc(80px + env(safe-area-inset-bottom))' as any
      : 80,
  },
});
