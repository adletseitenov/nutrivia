import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { RoundButton } from '@/components/round-button';
import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { Txt } from '@/components/txt';
import { useAppStore } from '@/store/app-store';
import { space } from '@/theme/tokens';
import { useColors } from '@/theme/use-colors';

/** Имя тренера или нутрициолога — его видят ученики. */
export default function ProName() {
  const c = useColors();
  const { state, dispatch } = useAppStore();
  const name = state.signup.name;
  const isTrainer = state.signup.role === 'trainer';

  return (
    <Screen footer={<Button title="Продолжить" block disabled={!name.trim()} onPress={() => router.push('/phone')} />}>
      <View style={styles.head}>
        <RoundButton icon="back" label="Назад" onPress={() => router.back()} />
        <View style={[styles.progress, { backgroundColor: c.track }]}>
          <View style={[styles.progressFill, { backgroundColor: c.ink }]} />
        </View>
        <Txt variant="caption" tone="muted">2 из 4</Txt>
      </View>
      <View style={{ gap: space[2] }}>
        <Txt variant="display">Как вас зовут?</Txt>
        <Txt tone="muted">
          {isTrainer
            ? 'Имя увидят ваши ученики, когда введут ваш код. Учеников может быть до 5.'
            : 'Имя увидят ваши клиенты, когда введут ваш код.'}
        </Txt>
      </View>
      <TextField
        label="Имя"
        value={name}
        onChangeText={(v) => dispatch({ type: 'setSignup', patch: { name: v } })}
        placeholder="Например, Динара"
        autoFocus
        autoCapitalize="words"
        textContentType="givenName"
        maxLength={60}
        returnKeyType="next"
        onSubmitEditing={() => name.trim() && router.push('/phone')}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  progress: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden' },
  progressFill: { width: '50%', height: 4, borderRadius: 2 },
});
