import { DarkTheme, DefaultTheme, ThemeProvider, Stack, usePathname, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View, useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AppSidebar } from '@/components/app-sidebar';
import { EventsProvider } from '@/context/events-context';
import * as usersService from '@/utilities/users-service';
import { dvw } from '@/utilities/responsive-dimensions';

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
    const router = useRouter();
    const pathname = usePathname();
    const [isLoggedIn, setIsLoggedIn] = useState(() => Boolean(usersService.getUser()));
    const showSidebar = isLoggedIn && pathname !== '/signup' && pathname !== '/login';
    const isPublicRoute = pathname === '/' || pathname === '/login' || pathname === '/signup';

    useEffect(() => {
      const syncAuthState = () => {
        setIsLoggedIn(Boolean(usersService.getUser()));
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
          <View style={styles.shell}>
            {showSidebar && <AppSidebar />}
            <View style={styles.content}>
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
  },
  content: {
    flex: 1,
    minWidth: dvw(0),
  },
});
