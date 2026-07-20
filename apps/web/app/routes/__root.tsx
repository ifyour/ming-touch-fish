import {
  Anchor,
  Box,
  Button,
  ColorSchemeScript,
  Container,
  createTheme,
  Group,
  MantineProvider,
  Text,
  Title,
} from '@mantine/core';
import mantineCoreCss from '@mantine/core/styles.css?inline';
import { Notifications } from '@mantine/notifications';
import mantineNotificationsCss from '@mantine/notifications/styles.css?inline';
import { QueryClientProvider } from '@tanstack/react-query';
import { createRootRouteWithContext, Link, Outlet, useNavigate } from '@tanstack/react-router';
import { Scripts } from '@tanstack/react-start';
import { useCallback, useRef } from 'react';
import { Footer } from '../components/Footer';
import { signIn, signOut, useSession } from '../lib/auth-client';
import type { RouterContext } from '../router';

const theme = createTheme({
  primaryColor: 'blue',
  defaultRadius: 'md',
});

function NotFound() {
  return (
    <Container size="md" py="xl">
      <Title order={2}>页面未找到</Title>
      <Text c="dimmed" mt="sm">
        请求的页面不存在，请返回首页。
      </Text>
      <Button component={Link} to="/" mt="md">
        返回首页
      </Button>
    </Container>
  );
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
  notFoundComponent: NotFound,
});

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const navigate = useNavigate();
  const clickCountRef = useRef(0);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const handleTouchFishClick = useCallback(() => {
    clickCountRef.current += 1;
    if (clickCountRef.current >= 3) {
      clickCountRef.current = 0;
      navigate({ to: '/fish' });
      return;
    }
    clearTimeout(clickTimerRef.current);
    clickTimerRef.current = setTimeout(() => {
      clickCountRef.current = 0;
    }, 1500);
  }, [navigate]);

  const { data: session, isPending } = useSession();

  const handleLogin = () => {
    void signIn.social({ provider: 'github', callbackURL: '/' });
  };

  const handleLogout = async () => {
    await signOut();
    location.reload();
  };

  const userMenu = isPending ? null : session?.user ? (
    <Group gap={6}>
      {session.user.image ? (
        <img
          src={session.user.image}
          alt=""
          width={24}
          height={24}
          style={{ borderRadius: '50%', objectFit: 'cover' }}
        />
      ) : null}
      <Text size="sm">
        {(session.user as { displayName?: string | null }).displayName ??
          session.user.name ??
          session.user.email}
      </Text>
      <Anchor
        component="button"
        size="xs"
        c="dimmed"
        onClick={handleLogout}
        style={{ cursor: 'pointer' }}
      >
        退出
      </Anchor>
    </Group>
  ) : (
    <Anchor
      component="button"
      size="sm"
      fw={500}
      onClick={handleLogin}
      style={{ cursor: 'pointer' }}
    >
      登录
    </Anchor>
  );

  return (
    <html lang="zh-CN">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>摸鱼资讯 - 聚合精选技术资讯与优质内容</title>
        <meta name="description" content="摸鱼资讯 - 聚合精选技术资讯与优质内容，一站式阅读体验" />
        <meta property="og:title" content="摸鱼资讯 - 聚合精选技术资讯与优质内容，一站式阅读体验" />
        <meta property="og:description" content="聚合精选技术资讯与优质内容，一站式阅读体验" />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="摸鱼资讯" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <ColorSchemeScript defaultColorScheme="light" />
        <style dangerouslySetInnerHTML={{ __html: mantineCoreCss }} />
        <style dangerouslySetInnerHTML={{ __html: mantineNotificationsCss }} />
        <style>{`.article-link{color:inherit;text-decoration:none}.article-link:visited{color:var(--mantine-color-gray-5)}`}</style>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var a=JSON.parse(localStorage.getItem('read_articles')||'[]');if(a.length){var s=document.createElement('style');s.id='r';for(var i=0;i<a.length;i+=50){s.textContent+='.article-link[data-article-id="'+a.slice(i,i+50).join('"],.article-link[data-article-id="')+'"]{color:var(--mantine-color-gray-5)}'}document.head.appendChild(s)}}catch(e){}`,
          }}
        />
      </head>
      <body>
        <div id="root">
          <QueryClientProvider client={queryClient}>
            <MantineProvider theme={theme} forceColorScheme="light">
              <Notifications position="top-right" />
              <Box
                component="header"
                py="sm"
                style={{ borderBottom: '1px solid var(--mantine-color-gray-2)' }}
              >
                <Container
                  size="xl"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <Group gap="xs">
                    {/* <img
                      src="/logo.svg"
                      alt="摸鱼资讯"
                      width={40}
                      height={40}
                      style={{ borderRadius: 6, position: 'relative', right: -4 }}
                    /> */}
                    <Title order={3}>
                      <Link to="/" style={{ textDecoration: 'none', color: 'inherit' }}>
                        摸鱼资讯
                      </Link>
                    </Title>
                    <Text
                      size="xs"
                      c="dimmed"
                      fw={500}
                      style={{ cursor: 'default', userSelect: 'none' }}
                      onClick={handleTouchFishClick}
                    >
                      TouchFish News
                    </Text>
                  </Group>
                  {userMenu}
                </Container>
              </Box>
              <Box p="md">
                <Outlet />
              </Box>
              <Box
                component="footer"
                py="md"
                style={{ borderTop: '1px solid var(--mantine-color-gray-2)' }}
              >
                <Footer />
              </Box>
            </MantineProvider>
          </QueryClientProvider>
        </div>
        <Scripts />
      </body>
    </html>
  );
}
