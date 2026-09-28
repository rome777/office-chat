import { networkInterfaces } from "node:os";

// 개발 모드에서 Next.js 는 localhost 가 아닌 주소의 접속을 막는다.
// 같은 네트워크의 팀원이 http://<이 컴퓨터 IP>:3000 으로 들어올 수 있게 이 컴퓨터의 IPv4 주소를 허용한다.
const localIps = Object.values(networkInterfaces())
  .flat()
  .filter((n) => n && n.family === "IPv4" && !n.internal)
  .map((n) => n.address);

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: localIps,
};

export default nextConfig;
