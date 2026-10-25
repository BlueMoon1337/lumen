import { parseLyrics } from './lyrics';
import type { Category, Message, Playlist, Presentation, Theme } from './types';
import { uid } from './util';

const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';

const baseTheme: Omit<Theme, 'id' | 'name'> = {
  fontFamily: SANS,
  fontSize: 96,
  fontWeight: 700,
  italic: false,
  color: '#ffffff',
  textAlign: 'center',
  verticalAlign: 'middle',
  uppercase: false,
  lineHeight: 1.2,
  shadow: true,
  outline: 0,
  outlineColor: '#000000',
  inset: { top: 8, right: 8, bottom: 8, left: 8 },
  boxColor: '',
  captionScale: 0.45,
  background: { type: 'gradient', color: '#0f172a', color2: '#1e3a5f' },
};

export const defaultThemes: Theme[] = [
  { ...baseTheme, id: 'theme-classic', name: 'Classic' },
  {
    ...baseTheme,
    id: 'theme-bold',
    name: 'Bold Caps',
    fontSize: 120,
    fontWeight: 900,
    uppercase: true,
    lineHeight: 1.05,
    background: { type: 'gradient', color: '#2b0a3d', color2: '#b5179e' },
  },
  {
    ...baseTheme,
    id: 'theme-scripture',
    name: 'Scripture',
    fontFamily: SERIF,
    fontSize: 72,
    fontWeight: 400,
    textAlign: 'left',
    lineHeight: 1.35,
    inset: { top: 10, right: 10, bottom: 12, left: 10 },
    captionScale: 0.6,
    background: { type: 'gradient', color: '#1c1917', color2: '#44403c' },
  },
  {
    ...baseTheme,
    id: 'theme-lower-third',
    name: 'Lower Third',
    fontSize: 60,
    fontWeight: 600,
    verticalAlign: 'middle',
    lineHeight: 1.15,
    shadow: false,
    inset: { top: 74, right: 6, bottom: 5, left: 6 },
    boxColor: 'rgba(0, 0, 0, 0.72)',
    background: { type: 'color', color: '#00b140', color2: '#00b140' },
  },
];

function song(title: string, author: string, text: string, category: Category = 'song', themeId?: string): Presentation {
  return { id: uid(), title, author, category, themeId, ...parseLyrics(text), updatedAt: Date.now() };
}

export function seedPresentations(): Presentation[] {
  return [
    song(
      'Amazing Grace',
      'John Newton',
      `[Verse 1]
Amazing grace! How sweet the sound
That saved a wretch like me!

I once was lost, but now am found;
Was blind, but now I see.

[Verse 2]
'Twas grace that taught my heart to fear,
And grace my fears relieved;

How precious did that grace appear
The hour I first believed.

[Verse 3]
Through many dangers, toils and snares,
I have already come;

'Tis grace hath brought me safe thus far,
And grace will lead me home.

[Verse 4]
When we've been there ten thousand years,
Bright shining as the sun,

We've no less days to sing God's praise
Than when we'd first begun.`,
    ),
    song(
      'Holy, Holy, Holy',
      'Reginald Heber',
      `[Verse 1]
Holy, holy, holy! Lord God Almighty!
Early in the morning our song shall rise to Thee;

Holy, holy, holy, merciful and mighty!
God in three Persons, blessed Trinity!

[Verse 2]
Holy, holy, holy! All the saints adore Thee,
Casting down their golden crowns around the glassy sea;

Cherubim and seraphim falling down before Thee,
Who wert, and art, and evermore shalt be.

[Verse 3]
Holy, holy, holy! Though the darkness hide Thee,
Though the eye of sinful man Thy glory may not see;

Only Thou art holy; there is none beside Thee,
Perfect in power, in love, and purity.

[Verse 4]
Holy, holy, holy! Lord God Almighty!
All Thy works shall praise Thy Name, in earth, and sky, and sea;

Holy, holy, holy; merciful and mighty!
God in three Persons, blessed Trinity!`,
    ),
    song(
      'Doxology',
      'Thomas Ken',
      `[Chorus]
Praise God, from whom all blessings flow;
Praise Him, all creatures here below;

Praise Him above, ye heavenly host;
Praise Father, Son, and Holy Ghost.

[Tag]
Amen.`,
      'song',
      'theme-bold',
    ),
    song(
      'Welcome',
      '',
      `[Welcome]
Welcome!
~ We're glad you're here

[Info]
Connect with us
~ Visit the welcome table after the service

[Countdown]
Service begins soon
> Start the countdown timer before this slide`,
      'announcement',
    ),
  ];
}

export function seedPlaylist(presentations: Presentation[]): Playlist {
  const byTitle = (t: string) => presentations.find((p) => p.title === t)!.id;
  return {
    id: uid(),
    name: 'Sunday Service',
    items: [
      { id: uid(), type: 'header', label: 'Pre-service' },
      { id: uid(), type: 'presentation', presentationId: byTitle('Welcome') },
      { id: uid(), type: 'header', label: 'Worship' },
      { id: uid(), type: 'presentation', presentationId: byTitle('Holy, Holy, Holy') },
      { id: uid(), type: 'presentation', presentationId: byTitle('Amazing Grace') },
      { id: uid(), type: 'presentation', presentationId: byTitle('Doxology') },
    ],
  };
}

export const seedMessages: Message[] = [
  { id: uid(), text: 'Service starts in {countdown}' },
  { id: uid(), text: 'Parents of child #12, please come to the nursery' },
];
