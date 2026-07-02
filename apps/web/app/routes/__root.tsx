import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router';
import { Scripts } from '@tanstack/react-start';
import { AppShell, Container, Title, Text, Group, Button, ColorSchemeScript } from '@mantine/core';
import { MantineProvider, createTheme } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClientProvider } from '@tanstack/react-query';
import type { RouterContext } from '../router';
import mantineCoreCss from '@mantine/core/styles.css?inline';
import mantineNotificationsCss from '@mantine/notifications/styles.css?inline';

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
  return (
    <html lang="zh-CN">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>摸鱼资讯 - TouchFish News</title>
        <meta name="description" content="摸鱼资讯 - 聚合精选技术资讯与优质内容，一站式阅读体验" />
        <meta property="og:title" content="摸鱼资讯 - TouchFish News" />
        <meta property="og:description" content="聚合精选技术资讯与优质内容，一站式阅读体验" />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="摸鱼资讯" />
        <ColorSchemeScript defaultColorScheme="light" />
        <style dangerouslySetInnerHTML={{ __html: mantineCoreCss }} />
        <style dangerouslySetInnerHTML={{ __html: mantineNotificationsCss }} />
        <style>{`.article-link{color:inherit;text-decoration:none}.article-link:visited{color:var(--mantine-color-gray-5)}`}</style>
      </head>
      <body>
        <div id="root">
          <QueryClientProvider client={queryClient}>
              <MantineProvider theme={theme} forceColorScheme="light">
                <Notifications position="top-right" />
                <AppShell header={{ height: 60 }} padding="md">
                <AppShell.Header>
                  <Container
                    size="xl"
                    h="100%"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                  >
                    <Group gap="xs">
                      <Title order={3}>
                        <Link to="/" style={{ textDecoration: 'none', color: 'inherit' }}>
                          摸鱼资讯
                        </Link>
                      </Title>
                      <Text size="xs" c="dimmed" fw={500}>
                        TouchFish News
                      </Text>
                    </Group>
                    <Group>
                      <Button component={Link} to="/" variant="subtle">
                        首页
                      </Button>
                      <Button component={Link} to="/admin" variant="subtle">
                        管理
                      </Button>
                    </Group>
                  </Container>
                </AppShell.Header>
                <AppShell.Main>
                  <Outlet />
                </AppShell.Main>
              </AppShell>
            </MantineProvider>
          </QueryClientProvider>
        </div>
        <Scripts />
      </body>
    </html>
  );
}
