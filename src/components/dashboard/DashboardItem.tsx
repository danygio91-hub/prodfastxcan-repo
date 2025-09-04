
"use client";

import React from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowRight } from 'lucide-react';
import { cn } from "@/lib/utils";
import { Button } from '../ui/button';

export interface DashboardItemProps {
  title: string;
  description: string;
  icon: React.ElementType;
  href?: string;
  className?: string;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
}

const DashboardItem = React.forwardRef<HTMLDivElement, DashboardItemProps & React.HTMLAttributes<HTMLDivElement>>(
  ({ title, description, icon: Icon, href, className, onClick, ...rest }, ref) => {
    
    const cardClasses = cn(
        "hover:shadow-lg hover:border-primary/50 transition-all duration-300 group flex flex-col h-full",
        { 'cursor-pointer': !!href || !!onClick },
        className
    );

    const cardContent = (
        <>
            <CardHeader>
                <CardTitle className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Icon className="h-7 w-7 text-primary" />
                        <span>{title}</span>
                    </div>
                </CardTitle>
            </CardHeader>
            <CardContent className="flex-grow">
                <CardDescription>{description}</CardDescription>
            </CardContent>
            <CardFooter>
                <Button variant="link" className="p-0 h-auto text-primary">
                    Vai alla funzione
                    <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
            </CardFooter>
        </>
    );

    if (href) {
      return (
        <Link href={href} className="block h-full" {...rest}>
          <Card ref={ref} className={cardClasses}>
            {cardContent}
          </Card>
        </Link>
      );
    }
    
    return (
      <Card ref={ref} className={cardClasses} onClick={onClick} {...rest}>
        {cardContent}
      </Card>
    );
  }
);

DashboardItem.displayName = 'DashboardItem';

export default DashboardItem;
