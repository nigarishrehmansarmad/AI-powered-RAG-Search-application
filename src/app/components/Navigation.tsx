'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

export default function Navigation() {
  const pathname = usePathname();
  const router = useRouter();

  const navItems = [
    { href: '/', label: 'Search' },
    { href: '/documents', label: 'Documents' },
  ];

  const handleLogout = async () => {
    await fetch('/api/auth', { method: 'DELETE' });
    router.replace('/login');
  };

  return (
    <nav className="border-b border-gray-200 dark:border-gray-800 mb-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-4">
          <div className="flex space-x-8">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                pathname === item.href
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              {item.label}
            </Link>
          ))}
          </div>
          <button
            onClick={handleLogout}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white"
          >
            Logout
          </button>
        </div>
      </div>
    </nav>
  );
}