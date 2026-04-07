import { useContext } from 'react';
import AuthGate from '../components/AuthGate';
import NavBar from '../components/NavBar';
import { ProfileContext } from './_app';
import Chat from '../components/Chat';

export default function Home() {
  const { profile } = useContext(ProfileContext);
  return (
    <AuthGate>
      <NavBar />
      <Chat profile={profile} persistChats={true} />
    </AuthGate>
  );
}
