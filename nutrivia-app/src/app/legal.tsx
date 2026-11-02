import { router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { RoundButton } from '@/components/round-button';
import { Screen } from '@/components/screen';
import { Txt } from '@/components/txt';
import { LEGAL, type LegalDoc } from '@/lib/legal';
import { space } from '@/theme/tokens';

/** Политика конфиденциальности или условия использования (?doc=privacy|terms). Доступно без входа. */
export default function Legal() {
  const { doc } = useLocalSearchParams<{ doc?: LegalDoc }>();
  const d = LEGAL[doc === 'terms' ? 'terms' : 'privacy'];
  return (
    <Screen>
      <RoundButton icon="back" label="Назад" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      <Txt variant="display">{d.title}</Txt>
      {d.sections.map(([h, text]) => (
        <View key={h} style={{ gap: space[1] }}>
          <Txt variant="headline">{h}</Txt>
          <Txt tone="muted">{text}</Txt>
        </View>
      ))}
    </Screen>
  );
}
