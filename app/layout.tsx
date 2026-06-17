import type { Metadata } from 'next';
import '@sungbinhwang-beaverworksinc/design-system/styles.css';
import './globals.css';
import { DsPortals } from './ds-portals';

export const metadata: Metadata = {
  title: 'Notion Manual Pipeline',
  description: 'PPT 매뉴얼을 노션 매뉴얼로 변환하고 편집하는 파이프라인',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>
        {children}
        <DsPortals />
      </body>
    </html>
  );
}
