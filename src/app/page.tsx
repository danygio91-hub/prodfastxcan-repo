import LoginForm from "@/components/forms/LoginForm";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 bg-gradient-to-br from-primary/10 via-background/50 to-background">
      <LoginForm />
    </main>
  );
}
