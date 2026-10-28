import Svg, { Circle, Rect } from 'react-native-svg';

/** Демо-«фото» плова, пока нет реальных снимков. Повторяет заглушку с холста. */
export function PlovArt({ width, height }: { width: number; height: number }) {
  return (
    <Svg width={width} height={height} viewBox="0 0 800 800" preserveAspectRatio="xMidYMid slice">
      <Rect width="800" height="800" fill="#B8875A" />
      <Rect y="0" width="800" height="120" fill="#A97A4F" />
      <Rect y="300" width="800" height="90" fill="#C29263" />
      <Rect y="610" width="800" height="110" fill="#A97A4F" />
      <Circle cx="400" cy="400" r="320" fill="#F7F5F0" />
      <Circle cx="400" cy="400" r="292" fill="#EEEAE2" />
      <Circle cx="400" cy="400" r="250" fill="#E3B35A" />
      <Circle cx="330" cy="330" r="70" fill="#E9BF6A" />
      <Circle cx="470" cy="470" r="90" fill="#D9A54C" />
      <Circle cx="460" cy="320" r="60" fill="#EDC676" />
      <Circle cx="340" cy="470" r="64" fill="#DDAA52" />
      <Rect x="300" y="300" width="70" height="56" rx="18" fill="#7A3F22" />
      <Rect x="420" y="380" width="80" height="60" rx="20" fill="#874A29" />
      <Rect x="330" y="420" width="64" height="52" rx="16" fill="#6E381E" />
      <Rect x="470" y="270" width="58" height="46" rx="15" fill="#7E4325" />
      <Rect x="250" y="390" width="40" height="14" rx="7" fill="#EE7A2C" />
      <Rect x="510" y="440" width="46" height="14" rx="7" fill="#EE7A2C" />
      <Rect x="380" y="250" width="44" height="13" rx="6" fill="#F08A3A" />
      <Circle cx="400" cy="390" r="30" fill="#F4EBD5" />
      <Circle cx="540" cy="360" r="10" fill="#4C8A3A" />
      <Circle cx="270" cy="460" r="9" fill="#5C9A46" />
      <Circle cx="660" cy="150" r="70" fill="#F7F5F0" />
      <Circle cx="660" cy="150" r="52" fill="#B9733A" />
    </Svg>
  );
}
