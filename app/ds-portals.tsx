'use client';

import { DialogContainer, ToastContainer } from '@sungbinhwang-beaverworksinc/design-system';

// 디자인시스템의 토스트/다이얼로그 포털. createContext 기반이라 'use client' 경계에서만 마운트한다.
export function DsPortals() {
  return (
    <>
      <ToastContainer />
      <DialogContainer />
    </>
  );
}
