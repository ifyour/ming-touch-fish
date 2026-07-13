import { Container, Group, Text } from '@mantine/core';

export function Footer() {
  return (
    <Container
      size="xl"
      h="100%"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <Group gap="xs">
        <Text size="sm" c="dimmed">
          © {new Date().getFullYear()} 摸鱼资讯
        </Text>
        <Text size="sm" c="dimmed">
          ·
        </Text>
        <Text size="sm" c="dimmed">
          聚合精选技术资讯与优质内容
        </Text>
      </Group>
    </Container>
  );
}
